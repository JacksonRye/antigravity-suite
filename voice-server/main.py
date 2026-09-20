import asyncio
import base64
import json
import logging
import os

from dotenv import load_dotenv
from fastapi import FastAPI, Query, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, Response
from fastapi.staticfiles import StaticFiles
from gemini_live import GeminiLive
from google.genai import types
try:
    from twilio_handler import TwilioHandler
except (ImportError, ModuleNotFoundError):
    TwilioHandler = None

# Load environment variables
load_dotenv()

# Configure logging - DEBUG for our modules, INFO for everything else
logging.basicConfig(level=logging.INFO)
logging.getLogger("gemini_live").setLevel(logging.DEBUG)
logging.getLogger(__name__).setLevel(logging.DEBUG)
logger = logging.getLogger(__name__)

# Configuration
GEMINI_API_KEY = os.getenv("GEMINI_API_KEY")
MODEL = os.getenv("MODEL", "gemini-3.8-live")

# Twilio config (optional — only needed for phone call integration)
TWILIO_ACCOUNT_SID = os.getenv("TWILIO_ACCOUNT_SID")
TWILIO_AUTH_TOKEN = os.getenv("TWILIO_AUTH_TOKEN")
TWILIO_APP_HOST = os.getenv("TWILIO_APP_HOST")

from transcript_watcher import TranscriptWatcher

# Initialize FastAPI
app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Active WebSocket connections
connected_clients = set()
active_text_queues = set()

async def broadcast_audio(chunk: bytes):
    for ws in list(connected_clients):
        try:
            await ws.send_bytes(chunk)
        except Exception:
            pass

async def broadcast_transcript(text: str):
    for ws in list(connected_clients):
        try:
            await ws.send_json({"type": "model", "text": text})
        except Exception:
            pass

async def broadcast_turn_complete():
    for ws in list(connected_clients):
        try:
            await ws.send_json({"type": "turn_complete"})
        except Exception:
            pass

async def broadcast_context_update(text: str):
    for q in list(active_text_queues):
        try:
            await q.put({"text": text, "turn_complete": False})
        except Exception:
            pass

async def broadcast_agent_turn(prompt: str):
    for q in list(active_text_queues):
        try:
            await q.put({"text": prompt, "turn_complete": True})
        except Exception:
            pass

watcher = TranscriptWatcher(
    model=MODEL,
    on_audio_chunk=broadcast_audio,
    on_transcript=broadcast_transcript,
    on_turn_complete=broadcast_turn_complete,
    on_context_update=broadcast_context_update,
    on_agent_turn_completed=broadcast_agent_turn,
)

@app.on_event("startup")
async def startup_event():
    logger.info("Starting Antigravity Transcript Watcher daemon...")
    asyncio.create_task(watcher.run())

# Serve static files
app.mount("/static", StaticFiles(directory="frontend"), name="static")


@app.get("/")
async def root():
    return FileResponse("frontend/index.html")


@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket, conversation_id: str | None = None):
    """WebSocket endpoint for Gemini Live."""
    # Close any existing connected clients to ensure single active session without duplicate audio
    for old_ws in list(connected_clients):
        try:
            await old_ws.close()
        except Exception:
            pass
    connected_clients.clear()
    active_text_queues.clear()

    await websocket.accept()
    connected_clients.add(websocket)
    logger.info(f"WebSocket connection accepted (active clients: {len(connected_clients)})")

    audio_input_queue = asyncio.Queue()
    video_input_queue = asyncio.Queue()
    text_input_queue = asyncio.Queue()
    active_text_queues.add(text_input_queue)

    async def audio_output_callback(data):
        await websocket.send_bytes(data)

    async def audio_interrupt_callback():
        watcher.stop_current_playback()

    chat_context_tool = types.Tool(
        function_declarations=[
            types.FunctionDeclaration(
                name="get_active_chat_context",
                description="Call this tool whenever the user asks what was discussed earlier, asks about prior decisions, asks to recall earlier tasks or steps, or asks what you or Antigravity did previously in the chat.",
                parameters=types.Schema(
                    type=types.Type.OBJECT,
                    properties={
                        "turns_back": types.Schema(
                            type=types.Type.INTEGER,
                            description="Number of past turns to retrieve (defaults to 30, up to 100)."
                        ),
                        "focus_query": types.Schema(
                            type=types.Type.STRING,
                            description="Optional keyword or topic filter (e.g. 'audio', 'database', 'websocket')."
                        )
                    }
                )
            )
        ]
    )

    gemini_client = GeminiLive(
        api_key=GEMINI_API_KEY,
        model=MODEL,
        input_sample_rate=16000,
        tools=[chat_context_tool],
        tool_mapping={"get_active_chat_context": watcher.get_active_chat_context}
    )

    # Initialize conversation context
    try:
        if conversation_id:
            logger.info(f"Connection query specified conversation_id: {conversation_id}")
            watcher.set_active_conversation(conversation_id, force=True)
        else:
            active = watcher.find_active_conversation()
            if active:
                watcher.switch_to_conversation(active)
    except Exception as e:
        logger.error(f"Error initializing transcript context: {e}")

    async def receive_from_client():
        try:
            while True:
                message = await websocket.receive()

                if message.get("bytes"):
                    watcher.stop_current_playback()
                    await audio_input_queue.put(message["bytes"])
                elif message.get("text"):
                    text = message["text"]
                    try:
                        payload = json.loads(text)
                        if isinstance(payload, dict):
                            if payload.get("type") == "image":
                                logger.info(f"Received image chunk from client: {len(payload['data'])} base64 chars")
                                image_data = base64.b64decode(payload["data"])
                                await video_input_queue.put(image_data)
                                continue
                            elif payload.get("type") == "set_active_conversation":
                                conv_id = payload.get("conversation_id")
                                logger.info(f"Client requested pin to active conversation: {conv_id}")
                                watcher.set_active_conversation(conv_id)
                                continue
                            elif "text" in payload and isinstance(payload["text"], str):
                                text = payload["text"]
                    except json.JSONDecodeError:
                        pass

                    await text_input_queue.put(text)
        except WebSocketDisconnect:
            logger.info("WebSocket disconnected")
        except Exception as e:
            logger.error(f"Error receiving from client: {e}")

    receive_task = asyncio.create_task(receive_from_client())

    async def run_session():
        async for event in gemini_client.start_session(
            audio_input_queue=audio_input_queue,
            video_input_queue=video_input_queue,
            text_input_queue=text_input_queue,
            audio_output_callback=audio_output_callback,
            audio_interrupt_callback=audio_interrupt_callback,
        ):
            if event:
                try:
                    await websocket.send_json(event)
                except Exception:
                    break

    try:
        await run_session()
    except Exception as e:
        import traceback
        logger.error(f"Error in Gemini session: {type(e).__name__}: {e}\n{traceback.format_exc()}")
    finally:
        connected_clients.discard(websocket)
        active_text_queues.discard(text_input_queue)
        if not connected_clients:
            watcher.pinned_conversation_id = None
        receive_task.cancel()
        try:
            await websocket.close()
        except Exception:
            pass


# ─── Twilio Endpoints ─────────────────────────────────────────────────────────

@app.post("/twilio/inbound")
async def twilio_inbound():
    """Handles inbound Twilio calls. Returns TwiML to open a media stream."""
    host = TWILIO_APP_HOST or "localhost:8000"
    twiml = f"""<?xml version="1.0" encoding="UTF-8"?>
<Response>
    <Say>Connecting to Gemini Live.</Say>
    <Connect>
        <Stream url="wss://{host}/twilio/stream" />
    </Connect>
</Response>"""
    return Response(content=twiml, media_type="application/xml")


@app.post("/twilio/outbound")
async def twilio_outbound(
    to_number: str = Query(..., description="Destination phone number (E.164 format)"),
    from_number: str = Query(..., description="Your Twilio phone number (E.164 format)"),
):
    """Initiates an outbound Twilio call that connects to Gemini Live."""
    if not TWILIO_ACCOUNT_SID or not TWILIO_AUTH_TOKEN:
        return {"error": "TWILIO_ACCOUNT_SID and TWILIO_AUTH_TOKEN must be set in environment"}
    if not TWILIO_APP_HOST:
        return {"error": "TWILIO_APP_HOST must be set in environment"}

    from twilio.rest import Client as TwilioClient

    client = TwilioClient(TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN)
    twiml = f"""<Response>
    <Say>Connecting to Gemini Live.</Say>
    <Connect>
        <Stream url="wss://{TWILIO_APP_HOST}/twilio/stream" />
    </Connect>
</Response>"""

    call = client.calls.create(
        to=to_number,
        from_=from_number,
        twiml=twiml,
    )
    logger.info(f"Outbound call initiated: {call.sid}")
    return {"callSid": call.sid, "status": call.status}


@app.websocket("/twilio/stream")
async def twilio_stream(websocket: WebSocket):
    """WebSocket endpoint for Twilio Media Streams."""
    await websocket.accept()
    logger.info("Twilio media stream WebSocket connected")

    handler = TwilioHandler(gemini_api_key=GEMINI_API_KEY, model=MODEL)
    try:
        await handler.handle_media_stream(websocket)
    except Exception as e:
        logger.error(f"Twilio stream error: {e}", exc_info=True)
    finally:
        try:
            await websocket.close()
        except Exception:
            pass
        logger.info("Twilio media stream WebSocket closed")


if __name__ == "__main__":
    import uvicorn

    port = int(os.getenv("PORT", 8000))
    uvicorn.run(app, host="0.0.0.0", port=port)
