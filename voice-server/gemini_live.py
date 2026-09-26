import asyncio
import inspect
import logging
import traceback

logger = logging.getLogger(__name__)
from google import genai
from google.genai import types

class GeminiLive:
    """
    Handles the interaction with the Gemini Live API.
    """
    def __init__(self, api_key, model, input_sample_rate, tools=None, tool_mapping=None):
        """
        Initializes the GeminiLive client.

        Args:
            api_key (str): The Gemini API Key.
            model (str): The model name to use.
            input_sample_rate (int): The sample rate for audio input.
            tools (list, optional): List of tools to enable. Defaults to None.
            tool_mapping (dict, optional): Mapping of tool names to functions. Defaults to None.
        """
        import os
        # Live bidirectional API on Vertex requires gemini-live-2.5-flash-native-audio
        if model in ("gemini-2.5-flash", "gemini-2.0-flash-exp", "gemini-2.0-flash", "gemini-3.8-live"):
            model = "gemini-live-2.5-flash-native-audio"
        self.api_key = api_key
        self.model = model
        self.input_sample_rate = input_sample_rate
        project = os.getenv("VERTEX_PROJECT") or os.getenv("GOOGLE_CLOUD_PROJECT") or "547362416538"
        location = os.getenv("VERTEX_LOCATION") or "us-central1"
        if api_key and api_key.startswith("AQ."):
            self.client = genai.Client(vertexai=True, api_key=api_key, project=project, location=location)
        elif os.getenv("GOOGLE_GENAI_USE_ENTERPRISE") == "True" or not api_key:
            self.client = genai.Client(vertexai=True, project=project, location=location)
        else:
            self.client = genai.Client(api_key=api_key)
        self.tools = tools or []
        self.tool_mapping = tool_mapping or {}

    async def start_session(self, audio_input_queue, video_input_queue, text_input_queue, audio_output_callback, audio_interrupt_callback=None):
        from memory_manager import load_memory
        persistent_memory = load_memory()
        
        system_prompt = f"""You are the AI Pair-Programming Butler paired with the developer using Antigravity IDE.

### LONG-TERM DEVELOPER MEMORY & CONTEXT:
{persistent_memory}

### OPERATIONAL DIRECTIVES:
1. You are the VOICE BUTLER. Antigravity is the IDE and its on-screen coding agent in the chat panel.
2. You have full visibility into the Antigravity chat window and editor via real-time context updates sent to you.
3. When the developer asks if you can see what is in the chat, confirm that you can see it and briefly cite or summarize what is currently in the chat.
4. Keep spoken responses natural, engaging, and conversational. Talk like a sharp, friendly senior pair-programming partner sitting right next to the developer. Explain things in simple, conversational, plain English (ELI5) without missing a single important detail.
5. When the developer discusses tasks or features, discuss approaches, trade-offs, and requirements verbally.
6. When the developer asks about earlier decisions, history, or context in this session, call the get_active_chat_context tool. When answering, first verbally announce that you checked the chat transcript using your tool (e.g. 'I checked our chat transcript using the context tool...'), then give a rich, clear explanation of what was found.
7. When the on-screen Antigravity coding agent finishes executing a task, deliver a thorough, high-impact spoken breakdown. Do NOT arbitrarily limit yourself to 1 or 2 brief sentences; take whatever time is needed to be clear and informative, while keeping it conversational and ELI5. Walk through:
   - What the developer's core goal or underlying issue was in simple terms.
   - Exactly what was changed, fixed, or added, explaining WHY in clear plain English.
   - The specific files modified and key commands/tests run, citing the actual outcomes.
   - Clear advice on what to test or tackle next so the developer never misses a beat.
8. Never read raw code blocks, file diffs, or markdown tables aloud. Translate technical details into natural, spoken English.
9. You have the ability to WRITE into Antigravity's on-screen chat box using the write_to_chat tool.
   - Use write_to_chat ONLY when the developer explicitly asks you to write code, edit files, run a command, or direct the IDE agent to build or fix something in the workspace.
   - Set submit=True if the developer explicitly says "send", "run", "execute", "tell the agent", or "submit".
   - Set submit=False if the developer says "type", "draft", "write", or wants to review it first.
   - Always formulate a clear, actionable prompt tailored for the coding agent.
   - When confirming verbally, state what you drafted or submitted in one crisp sentence (e.g., 'I've typed out the prompt to refactor the database and submitted it to the agent.').
10. You have your own live WEB SEARCH tool: search_web.
   - When the developer asks you to search the web, lookup live information, find documentation, check library releases, or look something up online, call your own search_web tool directly.
   - Do NOT delegate web searches to Antigravity chat via write_to_chat unless the developer explicitly asks the coding agent in the chat to research something for a workspace code edit. Call search_web yourself and answer the developer verbally with the fresh findings.
11. You have a long-term MEMORY tool: remember_fact.
   - Whenever the developer tells you a new personal preference, workflow habit, technical convention, or explicitly says 'remember that ...', call the remember_fact tool immediately to store it permanently across chats.
   - Confirm verbally once remembered in a natural sentence (e.g. 'Got it, I've committed that to memory.').
12. Explanations & Conversational Pace:
   - When asked for an explanation (especially when requested for 'long', 'comprehensive', or 'in-depth' detail), deliver a thorough, rich, complete breakdown without summarizing, trimming essentials, or cutting corners.
   - Speak naturally with a relaxed conversational cadence, allowing pauses to match the developer's thoughtful thinking and speaking pace without jumping in abruptly.
13. Seamless Continuation & Tab Switch Resumption:
   - When switching conversations or when an explanation was interrupted, you will receive explicit continuation instructions via system context.
   - If the developer asks you to continue, says 'continue', 'what were you saying?', or asks to resume while back on the tab where the explanation originated, begin naturally with: "As I was saying," and seamlessly continue explaining the remaining portion without restarting from the beginning.
   - If the developer asks you to continue or resume while on a DIFFERENT tab from where the interrupted explanation started, do NOT continue the old explanation directly. State what you were explaining in the previous chat and what you are working on in the current chat, and ask which one they would like to discuss, exactly as instructed by the system directive."""

        config = types.LiveConnectConfig(
            response_modalities=[types.Modality.AUDIO],
            speech_config=types.SpeechConfig(
                voice_config=types.VoiceConfig(
                    prebuilt_voice_config=types.PrebuiltVoiceConfig(
                        voice_name="Puck"
                    )
                )
            ),
            system_instruction=types.Content(parts=[types.Part(text=system_prompt)]),
            input_audio_transcription=types.AudioTranscriptionConfig(),
            output_audio_transcription=types.AudioTranscriptionConfig(),
            realtime_input_config=types.RealtimeInputConfig(
                turn_coverage="TURN_INCLUDES_ONLY_ACTIVITY",
            ),
            tools=self.tools,
        )
        
        logger.info(f"Connecting to Gemini Live with model={self.model}")
        try:
          async with self.client.aio.live.connect(model=self.model, config=config) as session:
            logger.info("Gemini Live session opened successfully")
            
            async def send_audio():
                try:
                    while True:
                        chunk = await audio_input_queue.get()
                        await session.send_realtime_input(
                            audio=types.Blob(data=chunk, mime_type=f"audio/pcm;rate={self.input_sample_rate}")
                        )
                except asyncio.CancelledError:
                    logger.debug("send_audio task cancelled")
                except Exception as e:
                    logger.error(f"send_audio error: {e}\n{traceback.format_exc()}")

            async def send_video():
                try:
                    while True:
                        chunk = await video_input_queue.get()
                        logger.info(f"Sending video frame to Gemini: {len(chunk)} bytes")
                        await session.send_realtime_input(
                            video=types.Blob(data=chunk, mime_type="image/jpeg")
                        )
                except asyncio.CancelledError:
                    logger.debug("send_video task cancelled")
                except Exception as e:
                    logger.error(f"send_video error: {e}\n{traceback.format_exc()}")

            async def send_text():
                try:
                    while True:
                        msg = await text_input_queue.get()
                        if isinstance(msg, dict):
                            text = msg.get("text", "")
                            turn_complete = msg.get("turn_complete", True)
                        else:
                            text = str(msg)
                            turn_complete = True
                        logger.info(f"Sending text to Gemini (turn_complete={turn_complete}): {text[:100]}...")
                        await session.send_client_content(
                            turns=[types.Content(role="user", parts=[types.Part(text=text)])],
                            turn_complete=turn_complete,
                        )
                except asyncio.CancelledError:
                    logger.debug("send_text task cancelled")
                except Exception as e:
                    logger.error(f"send_text error: {e}\n{traceback.format_exc()}")

            event_queue = asyncio.Queue()

            async def receive_loop():
                try:
                    while True:
                        async for response in session.receive():
                            logger.debug(f"Received response from Gemini: {response}")
                            
                            # Log the raw response type for debugging
                            if response.go_away:
                                logger.warning(f"Received GoAway from Gemini: {response.go_away}")
                            if response.session_resumption_update:
                                logger.info(f"Session resumption update: {response.session_resumption_update}")
                            
                            server_content = response.server_content
                            tool_call = response.tool_call
                            
                            if server_content:
                                if server_content.model_turn:
                                    for part in server_content.model_turn.parts:
                                        if part.inline_data:
                                            if inspect.iscoroutinefunction(audio_output_callback):
                                                await audio_output_callback(part.inline_data.data)
                                            else:
                                                audio_output_callback(part.inline_data.data)
                                
                                if server_content.input_transcription and server_content.input_transcription.text:
                                    await event_queue.put({"type": "user", "text": server_content.input_transcription.text})
                                
                                if server_content.output_transcription and server_content.output_transcription.text:
                                    await event_queue.put({"type": "gemini", "text": server_content.output_transcription.text})
                                
                                if server_content.interaction_status:
                                    status_val = server_content.interaction_status
                                    status_str = status_val.name if hasattr(status_val, 'name') else str(status_val)
                                    logger.debug(f"Interaction status: {status_str}")
                                    await event_queue.put({"type": "interaction_status", "status": status_str})

                                if server_content.turn_complete:
                                    await event_queue.put({"type": "turn_complete"})
                                
                                if server_content.interrupted:
                                    if audio_interrupt_callback:
                                        if inspect.iscoroutinefunction(audio_interrupt_callback):
                                            await audio_interrupt_callback()
                                        else:
                                            audio_interrupt_callback()
                                    await event_queue.put({"type": "interrupted"})

                            if tool_call:
                                function_responses = []
                                for fc in tool_call.function_calls:
                                    func_name = fc.name
                                    args = fc.args or {}
                                    
                                    if func_name in self.tool_mapping:
                                        # Immediately notify frontend that a tool has started execution
                                        await event_queue.put({"type": "tool_start", "name": func_name, "args": args})
                                        try:
                                            tool_func = self.tool_mapping[func_name]
                                            if inspect.iscoroutinefunction(tool_func):
                                                result = await tool_func(**args)
                                            else:
                                                loop = asyncio.get_running_loop()
                                                result = await loop.run_in_executor(None, lambda: tool_func(**args))
                                        except Exception as e:
                                            result = f"Error: {e}"
                                        
                                        function_responses.append(types.FunctionResponse(
                                            name=func_name,
                                            id=fc.id,
                                            response={"result": result}
                                        ))
                                        await event_queue.put({"type": "tool_call", "name": func_name, "args": args, "result": result})
                                
                                await session.send_tool_response(function_responses=function_responses)
                                # Gemini Live completes tool turn without audio unless prompted to generate vocal synthesis:
                                await session.send_client_content(
                                    turns=[types.Content(role="user", parts=[types.Part(text="Based on what you just retrieved from the tool, please give your spoken response now.")])],
                                    turn_complete=True
                                )
                        
                        # session.receive() iterator ended (e.g. after turn_complete) — re-enter to keep listening
                        logger.debug("Gemini receive iterator completed, re-entering receive loop")

                except asyncio.CancelledError:
                    logger.debug("receive_loop task cancelled")
                except Exception as e:
                    logger.error(f"receive_loop error: {type(e).__name__}: {e}\n{traceback.format_exc()}")
                    await event_queue.put({"type": "error", "error": f"{type(e).__name__}: {e}"})
                finally:
                    logger.info("receive_loop exiting")
                    await event_queue.put(None)

            send_audio_task = asyncio.create_task(send_audio())
            send_video_task = asyncio.create_task(send_video())
            send_text_task = asyncio.create_task(send_text())
            receive_task = asyncio.create_task(receive_loop())

            try:
                while True:
                    event = await event_queue.get()
                    if event is None:
                        break
                    if isinstance(event, dict) and event.get("type") == "error":
                        # Just yield the error event, don't raise to keep the stream alive if possible or let caller handle
                        yield event
                        break 
                    yield event
            finally:
                logger.info("Cleaning up Gemini Live session tasks")
                send_audio_task.cancel()
                send_video_task.cancel()
                send_text_task.cancel()
                receive_task.cancel()
        except Exception as e:
            logger.error(f"Gemini Live session error: {type(e).__name__}: {e}\n{traceback.format_exc()}")
            raise
        finally:
            logger.info("Gemini Live session closed")
