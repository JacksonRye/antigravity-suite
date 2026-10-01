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

from web_tools import search_web
from memory_manager import remember_fact

# Load environment variables
load_dotenv(override=True)

# Configure logging - DEBUG for our modules, INFO for everything else
logging.basicConfig(level=logging.INFO)
logging.getLogger("gemini_live").setLevel(logging.DEBUG)
logging.getLogger(__name__).setLevel(logging.DEBUG)
logger = logging.getLogger(__name__)

# Configuration
GEMINI_API_KEY = os.getenv("GEMINI_API_KEY")
MODEL = os.getenv("MODEL", "gemini-live-2.5-flash-native-audio")

# Twilio config (optional — only needed for phone call integration)
TWILIO_ACCOUNT_SID = os.getenv("TWILIO_ACCOUNT_SID")
TWILIO_AUTH_TOKEN = os.getenv("TWILIO_AUTH_TOKEN")
TWILIO_APP_HOST = os.getenv("TWILIO_APP_HOST")

from transcript_watcher import TranscriptWatcher
from antigravity_controller import AntigravityChatController
from cdp_bridge import cdp_bridge

chat_controller = AntigravityChatController()

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


@app.get("/butler.user.js")
async def serve_userscript():
    return FileResponse(
        "frontend/butler.user.js",
        media_type="text/javascript",
        headers={"Cache-Control": "no-cache, no-store, must-revalidate", "Pragma": "no-cache"},
    )


@app.get("/butler.core.js")
async def serve_core_script():
    return FileResponse(
        "frontend/butler.core.js",
        media_type="text/javascript",
        headers={"Cache-Control": "no-cache, no-store, must-revalidate", "Pragma": "no-cache"},
    )


@app.get("/butler-extension.zip")
async def download_extension_zip():
    return FileResponse(
        "frontend/butler-extension.zip",
        media_type="application/zip",
        filename="butler-extension.zip",
        headers={"Cache-Control": "no-cache, no-store, must-revalidate"},
    )


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

    if conversation_id:
        logger.info(f"Client connected with explicit conversation_id: {conversation_id}")
        watcher.set_active_conversation(conversation_id, force=True)

    # Send current active conversation details to newly connected client
    try:
        cur_id = watcher.pinned_conversation_id or (watcher.current_path.split(os.sep)[-4] if watcher.current_path else "")
        cur_title = watcher.current_title or watcher.get_conversation_title(cur_id) or "Active Antigravity Session"
        await websocket.send_json({
            "type": "active_conversation_updated",
            "conversation_id": cur_id,
            "title": cur_title,
        })
    except Exception as e:
        logger.warning(f"Could not send active_conversation_updated: {e}")

    audio_input_queue = asyncio.Queue()
    video_input_queue = asyncio.Queue()
    text_input_queue = asyncio.Queue()
    active_text_queues.add(text_input_queue)

    last_write_event = asyncio.Event()
    last_write_success = [False]

    async def audio_output_callback(data):
        watcher.is_speaking = True
        await websocket.send_bytes(data)

    async def audio_interrupt_callback():
        watcher.is_speaking = False
        watcher.stop_current_playback()

    chat_tools = types.Tool(
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
            ),
            types.FunctionDeclaration(
                name="write_to_chat",
                description="Types a prompt into the Antigravity chat input box. Set submit=True if the developer explicitly said to send, run, execute, tell the agent, or submit it immediately. Set submit=False if the developer asked to type, draft, or write it without sending.",
                parameters=types.Schema(
                    type=types.Type.OBJECT,
                    required=["prompt"],
                    properties={
                        "prompt": types.Schema(
                            type=types.Type.STRING,
                            description="The complete, well-formulated prompt or task instructions to write into the Antigravity chat box for the coding agent."
                        ),
                        "submit": types.Schema(
                            type=types.Type.BOOLEAN,
                            description="Whether to submit the message immediately (true) or leave it drafted in the input box for manual review (false)."
                        )
                    }
                )
            ),
            types.FunctionDeclaration(
                name="search_web",
                description="Searches the live web for recent documentation, real-time facts, library versions, errors, or technical guides. Call this directly whenever asked to search, lookup latest information, or verify recent technical details.",
                parameters=types.Schema(
                    type=types.Type.OBJECT,
                    required=["query"],
                    properties={
                        "query": types.Schema(
                            type=types.Type.STRING,
                            description="The concise, keyword-focused search query."
                        )
                    }
                )
            ),
            types.FunctionDeclaration(
                name="remember_fact",
                description="Permanently stores a developer preference, habit, working rule, or personal fact into long-term memory across all chats and sessions. Call this whenever the developer shares a preference or asks you to remember something.",
                parameters=types.Schema(
                    type=types.Type.OBJECT,
                    required=["category", "fact"],
                    properties={
                        "category": types.Schema(
                            type=types.Type.STRING,
                            description="The category heading for the memory (e.g. 'Developer Profile & Cognitive Style', 'Workflow Directives', 'Technical Environment & Architecture', or 'Project & Domain Knowledge')."
                        ),
                        "fact": types.Schema(
                            type=types.Type.STRING,
                            description="The specific rule, habit, or preference to commit to memory."
                        )
                    }
                )
            ),
            types.FunctionDeclaration(
                name="list_all_conversations",
                description="Lists all current and past conversation threads in Antigravity with their titles, IDs, active status, and last activity time. Call this whenever the user asks what other conversations exist or wants an overview of previous sessions.",
                parameters=types.Schema(
                    type=types.Type.OBJECT,
                    properties={}
                )
            ),
            types.FunctionDeclaration(
                name="search_all_conversations",
                description="Searches across ALL conversation threads and past chat sessions for specific topics, decisions, code discussions, or prior tasks. Call this whenever the developer asks about what happened or was discussed in another conversation.",
                parameters=types.Schema(
                    type=types.Type.OBJECT,
                    required=["query"],
                    properties={
                        "query": types.Schema(
                            type=types.Type.STRING,
                            description="The keyword, topic, or search term to look for across all conversation histories."
                        )
                    }
                )
            ),
            types.FunctionDeclaration(
                name="get_conversation_context",
                description="Retrieves the detailed discussion and transcript turns of any specified conversation thread by ID or partial title. Call this to dive deeper into a past conversation found via list_all_conversations or search_all_conversations.",
                parameters=types.Schema(
                    type=types.Type.OBJECT,
                    required=["conversation_id_or_title"],
                    properties={
                        "conversation_id_or_title": types.Schema(
                            type=types.Type.STRING,
                            description="The UUID or title of the conversation to inspect."
                        ),
                        "turns_back": types.Schema(
                            type=types.Type.INTEGER,
                            description="Number of past turns to retrieve (defaults to 20)."
                        )
                    }
                )
            ),
            types.FunctionDeclaration(
                name="switch_active_conversation",
                description="Switches Puck's active conversation focus to any project or chat by name (e.g. 'Alter Ego', 'spokenly-bridge', 'CLI Project') or ID. Call this whenever the user asks to switch chats, mentions another project, or asks what is happening in a different conversation.",
                parameters=types.Schema(
                    type=types.Type.OBJECT,
                    required=["conversation_name_or_id"],
                    properties={
                        "conversation_name_or_id": types.Schema(
                            type=types.Type.STRING,
                            description="The name or title of the project or chat (e.g. 'Alter Ego')."
                        )
                    }
                )
            )
        ]
    )

    async def dispatch_write_to_chat(prompt: str, submit: bool = False):
        logger.info(f"dispatch_write_to_chat called via VPS CDP Bridge: '{prompt[:40]}...' (submit={submit})")

        # 1. Execute direct typing via Linux VPS CDP Bridge (native hardware-level input directly inside Antigravity)
        cdp_res = await cdp_bridge.write_and_submit_prompt(prompt, submit=submit)
        success = cdp_res.get("success", False)

        # 2. Broadcast status to connected clients (iPad Safari tab / PWA)
        for client_ws in list(connected_clients):
            try:
                await client_ws.send_json({
                    "type": "prompt_submitted_to_ide",
                    "prompt": prompt,
                    "submit": submit,
                    "success": success,
                })
            except Exception as e:
                logger.warning(f"Could not notify client ws: {e}")

        # 3. Fallback: if CDP failed, dispatch to in-tab client
        if not success:
            logger.info("CDP bridge did not succeed; dispatching to in-tab client as fallback...")
            for ws in list(connected_clients):
                try:
                    await ws.send_json({
                        "type": "client_write_to_chat",
                        "prompt": prompt,
                        "submit": submit,
                    })
                except Exception:
                    pass

        return {
            "success": bool(success),
            "cdp": cdp_res,
            "prompt": prompt,
            "submit": submit,
            "error": None if success else cdp_res.get("error", "Failed to type into IDE via CDP")
        }

    async def dispatch_switch_active_conversation(conversation_name_or_id: str):
        logger.info(f"dispatch_switch_active_conversation called: '{conversation_name_or_id}'")
        res = watcher.switch_active_conversation(conversation_name_or_id)
        if res.get("status") == "success":
            cid = res.get("conversation_id")
            title = res.get("title")
            # Navigate VPS Antigravity instance via CDP
            asyncio.create_task(cdp_bridge.navigate_to_conversation(cid))
            for ws in list(connected_clients):
                try:
                    await ws.send_json({
                        "type": "client_navigate_to_conv",
                        "conversation_id": cid,
                        "title": title,
                    })
                    logger.info(f"Dispatched client_navigate_to_conv to tab: {title} ({cid})")
                except Exception as e:
                    logger.warning(f"Could not send client_navigate_to_conv to client: {e}")
        return res

    gemini_client = GeminiLive(
        api_key=GEMINI_API_KEY,
        model=MODEL,
        input_sample_rate=16000,
        tools=[chat_tools],
        tool_mapping={
            "get_active_chat_context": watcher.get_active_chat_context,
            "list_all_conversations": watcher.list_all_conversations,
            "search_all_conversations": watcher.search_all_conversations,
            "get_conversation_context": watcher.get_conversation_context,
            "switch_active_conversation": dispatch_switch_active_conversation,
            "write_to_chat": dispatch_write_to_chat,
            "search_web": search_web,
            "remember_fact": remember_fact,
        }
    )

    # Initialize conversation context
    try:
        valid_candidate = False
        if conversation_id:
            cand_path = os.path.join(watcher.get_brain_dir(), conversation_id, ".system_generated", "logs", "transcript.jsonl")
            if os.path.exists(cand_path):
                logger.info(f"Connection query specified valid conversation_id: {conversation_id}")
                watcher.set_active_conversation(conversation_id, force=True)
                valid_candidate = True
            else:
                logger.warning(f"Ignored invalid/non-existent query conversation_id: {conversation_id}")

        if not valid_candidate:
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
                            elif payload.get("type") in ("set_active_conversation", "switch_active_conversation"):
                                conv_id = payload.get("conversation_id")
                                title = payload.get("title") or payload.get("conversation_name", "")

                                switched = False
                                if conv_id:
                                    cand_path = os.path.join(watcher.get_brain_dir(), str(conv_id), ".system_generated", "logs", "transcript.jsonl")
                                    if os.path.exists(cand_path):
                                        logger.info(f"Client requested pin to active conversation ID: {conv_id} ({title})")
                                        watcher.set_active_conversation(conv_id, title=title, force=True)
                                        switched = True

                                if not switched and title:
                                    res = watcher.switch_active_conversation(title)
                                    if res.get("status") == "success":
                                        conv_id = res.get("conversation_id")
                                        title = res.get("title")
                                        switched = True
                                        logger.info(f"Resolved title '{title}' to conv_id '{conv_id}'")

                                if switched:
                                    summary = watcher.get_rolling_summary(watcher.current_path, max_turns=5)
                                    sys_msg = (
                                        f"[SYSTEM UPDATE: The developer has switched active focus to chat '{title}' (id: {conv_id}). "
                                        f"Recent context from this conversation:\n{summary}\n"
                                        "You are now discussing this conversation.]"
                                    )
                                    await text_input_queue.put({"text": sys_msg, "turn_complete": False})
                                    await websocket.send_json({
                                        "type": "active_conversation_updated",
                                        "conversation_id": conv_id,
                                        "title": title,
                                    })
                                else:
                                    logger.warning(f"Could not switch conversation with conv_id='{conv_id}', title='{title}'")
                                continue
                            elif payload.get("type") == "client_write_success":
                                logger.info("In-tab client confirmed successful write!")
                                last_write_success[0] = True
                                last_write_event.set()
                                continue
                            elif payload.get("type") == "client_write_failed":
                                logger.warning(f"In-tab client reported write failure: {payload.get('error')}")
                                last_write_success[0] = False
                                last_write_event.set()
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
                if isinstance(event, dict) and event.get("type") in ("turn_complete", "interrupted"):
                    watcher.is_speaking = False
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
