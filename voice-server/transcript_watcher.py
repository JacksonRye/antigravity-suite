import asyncio
import glob
import json
import logging
import os
import re
import time
import urllib.request
from dotenv import load_dotenv

load_dotenv()

from google import genai
from google.genai import types

logger = logging.getLogger("transcript_watcher")
logger.setLevel(logging.INFO)

BUTLER_SYSTEM_INSTRUCTION = """You are the AI Pair-Programming Butler paired with the developer using Antigravity IDE.
Your relationship to Antigravity:
1. You are the VOICE BUTLER. Antigravity is the IDE and its on-screen coding agent in the chat panel.
2. You have full visibility into the Antigravity chat window and editor via real-time context updates sent to you.
3. When the developer asks if you can see what is in the chat, confirm that you can see it and briefly cite or summarize what is currently in the chat.
4. Keep spoken responses brief, natural, and conversational (1 to 2 sentences max). Talk like a smart, friendly pair-programming partner sitting next to the developer.
5. When the developer discusses tasks or features, discuss approaches and requirements verbally.
6. When the on-screen Antigravity coding agent finishes executing a task, translate what was done into a casual 1-2 sentence ELI5 spoken summary and ask what to do next.
7. Never read raw code blocks, file diffs, or markdown tables aloud."""

class TranscriptWatcher:
    def __init__(self, model="gemini-live-2.5-flash-native-audio", on_audio_chunk=None, on_transcript=None, on_turn_complete=None, on_context_update=None, on_agent_turn_completed=None):
        self.model = os.getenv("MODEL", model)
        self.on_audio_chunk = on_audio_chunk          # Stream 24kHz audio to WebSocket
        self.on_transcript = on_transcript            # Stream transcript to WebSocket
        self.on_turn_complete = on_turn_complete      # Signal turn complete
        self.on_context_update = on_context_update    # Send updated chat context into Gemini Live session (silent)
        self.on_agent_turn_completed = on_agent_turn_completed  # Trigger Butler to speak when agent finishes
        self.client = genai.Client()
        self.current_path = None
        self.pinned_conversation_id = None
        self.pinned_timestamp = 0
        self.last_pos = 0
        self.last_spoken_step = -1
        self.last_user_input_time = ""
        self.is_running = False
        self.pending_speech_task = None
        # Per-chat state map: {conv_id: {"last_pos": int, "last_spoken_step": int, "last_user_input_time": str}}
        self.conv_states = {}
        # Speech state and interruption management
        self.is_speaking = False
        self.current_speaking_summary = ""
        self.current_title = ""
        self.interrupted_summaries = {}  # {conv_id: {"text": str, "title": str}}
        self.last_interrupted_conv_id = None

    def get_brain_dir(self):
        return os.path.expanduser("~/.gemini/antigravity/brain")

    def get_rolling_summary(self, path, max_turns=5):
        if not path or not os.path.exists(path):
            return ""
        try:
            with open(path, "r", encoding="utf-8", errors="ignore") as f:
                lines = f.readlines()
            turns = []
            for l in reversed(lines):
                try:
                    d = json.loads(l)
                    if d.get("type") == "USER_INPUT" and d.get("content"):
                        prompt = d["content"].strip()
                        prompt = re.sub(r"<[^>]+>", "", prompt).strip()
                        turns.append("Developer: " + prompt[:250])
                    elif d.get("source") == "MODEL" and d.get("type") == "PLANNER_RESPONSE" and d.get("content") and not d.get("tool_calls"):
                        ans = d["content"].strip()
                        ans = re.sub(r"```[\s\S]*?```", "[code snippet]", ans)
                        ans = re.sub(r"\s+", " ", ans)[:250].strip()
                        turns.append("Antigravity: " + ans)
                    if len(turns) >= max_turns:
                        break
                except Exception:
                    pass
            turns.reverse()
            return "\n".join(turns)
        except Exception:
            return ""

    def get_active_chat_context(self, turns_back: int = 15, focus_query: str = "") -> dict:
        """
        Tool callable by Gemini Live to retrieve semantic history and previous discussion points
        from the active on-screen Antigravity chat session.
        """
        path = self.current_path or self.find_active_conversation()
        conv_id = self.pinned_conversation_id or "active"
        if not path or not os.path.exists(path):
            return {
                "status": "not_found",
                "conversation_id": conv_id,
                "message": "No active conversation transcript found.",
                "turns": []
            }

        try:
            with open(path, "r", encoding="utf-8", errors="ignore") as f:
                lines = f.readlines()

            extracted = []
            query_lower = focus_query.lower().strip() if focus_query else ""

            for l in reversed(lines):
                if not l.strip():
                    continue
                try:
                    d = json.loads(l)
                    t_type = d.get("type")
                    source = d.get("source")
                    step = d.get("step_index", 0)
                    content = d.get("content", "")

                    if t_type == "USER_INPUT" and content:
                        clean = re.sub(r"<[^>]+>", "", content).strip()
                        if query_lower and query_lower not in clean.lower():
                            continue
                        extracted.append({
                            "speaker": "Developer",
                            "step": step,
                            "summary": clean[:2500]
                        })
                    elif source == "MODEL" and t_type == "PLANNER_RESPONSE" and content:
                        clean = re.sub(r"```[\s\S]*?```", "[code snippet]", content)
                        clean = re.sub(r"\s+", " ", clean).strip()
                        if query_lower and query_lower not in clean.lower():
                            continue
                        extracted.append({
                            "speaker": "Antigravity",
                            "step": step,
                            "summary": clean[:2500]
                        })
                    elif d.get("tool_calls"):
                        # Capture tool actions taken during coding with rich descriptions
                        tool_summaries = []
                        for tc in d.get("tool_calls", []):
                            tc_name = tc.get("name")
                            tc_args = tc.get("args", {})
                            summary = tc_args.get("Instruction") or tc_args.get("toolSummary") or tc_args.get("Description") or ""
                            target = tc_args.get("TargetFile") or tc_args.get("CommandLine") or tc_args.get("AbsolutePath") or ""
                            if summary and target:
                                tool_summaries.append(f"{tc_name} ({target}): {summary}")
                            elif summary:
                                tool_summaries.append(f"{tc_name}: {summary}")
                            elif target:
                                tool_summaries.append(f"{tc_name}: {target}")
                        if tool_summaries:
                            joined = " | ".join(tool_summaries)
                            if query_lower and query_lower not in joined.lower():
                                continue
                            extracted.append({
                                "speaker": "Tool Actions",
                                "step": step,
                                "summary": joined[:2500]
                            })

                    if len(extracted) >= max(1, min(turns_back, 100)):
                        break
                except Exception:
                    pass

            extracted.reverse()
            logger.info(f"Tool get_active_chat_context executed: retrieved {len(extracted)} turns (conv: {conv_id}, query: '{focus_query}')")
            return {
                "status": "success",
                "conversation_id": conv_id,
                "total_turns_retrieved": len(extracted),
                "turns": extracted
            }
        except Exception as e:
            logger.error(f"Error in get_active_chat_context: {e}")
            return {
                "status": "error",
                "conversation_id": conv_id,
                "message": str(e),
                "turns": []
            }

    def extract_task_execution_context(self, path: str, final_step: int) -> dict:
        """
        Extracts the full execution arc for the task that just completed:
        1. Original user request / goal
        2. Specific files modified or created
        3. Terminal commands executed
        4. Key inspection steps taken
        """
        if not path or not os.path.exists(path):
            return {"user_goal": "", "actions": [], "files_touched": []}

        try:
            with open(path, "r", encoding="utf-8", errors="ignore") as f:
                lines = f.readlines()

            user_goal = ""
            actions = []
            files_touched = set()

            for l in reversed(lines):
                if not l.strip():
                    continue
                try:
                    d = json.loads(l)
                    step = d.get("step_index", 0)
                    if step > final_step:
                        continue

                    # Find the user input that triggered this task execution cycle
                    if d.get("type") == "USER_INPUT":
                        raw = d.get("content", "")
                        m = re.search(r"<USER_REQUEST>(.*?)</USER_REQUEST>", raw, re.DOTALL)
                        if m:
                            user_goal = m.group(1).strip()
                        else:
                            user_goal = re.sub(r"<[^>]+>", "", raw).strip()
                        # Stop once we've reached the prompt that started this cycle
                        break

                    for tc in d.get("tool_calls", []):
                        name = tc.get("name")
                        args = tc.get("args", {})
                        instruction = args.get("Instruction") or args.get("Description") or args.get("toolSummary") or ""
                        instruction = str(instruction).strip("\"'")
                        target = args.get("TargetFile") or args.get("CommandLine") or args.get("AbsolutePath") or ""
                        target = str(target).strip("\"'")

                        if name in ["replace_file_content", "write_to_file"]:
                            fname = target.split("/")[-1] if "/" in target else target
                            if fname:
                                files_touched.add(fname)
                            actions.append(f"Modified {fname}: {instruction}" if instruction else f"Modified {fname}")
                        elif name == "run_command":
                            cmd_short = target[:80]
                            cmd_desc = args.get("toolSummary") or args.get("toolAction") or instruction
                            actions.append(f"Command '{cmd_short}': {cmd_desc}" if cmd_desc else f"Ran: {cmd_short}")
                except Exception:
                    pass

            actions.reverse()

            # Attempt to ingest walkthrough.md if generated or updated in this conversation
            walkthrough_summary = ""
            try:
                conv_dir = os.path.dirname(os.path.dirname(os.path.dirname(path)))
                wt_path = os.path.join(conv_dir, "walkthrough.md")
                if os.path.exists(wt_path):
                    with open(wt_path, "r", encoding="utf-8", errors="ignore") as wf:
                        raw_wt = wf.read()
                        clean_wt = re.sub(r"```[\s\S]*?```", "[code block]", raw_wt)
                        walkthrough_summary = clean_wt[:3000].strip()
            except Exception:
                pass

            return {
                "user_goal": user_goal[:1000],
                "actions": actions[-25:],
                "files_touched": list(files_touched),
                "walkthrough": walkthrough_summary
            }
        except Exception as e:
            logger.error(f"Error extracting execution context: {e}")
            return {"user_goal": "", "actions": [], "files_touched": [], "walkthrough": ""}

    def get_conversation_title(self, conv_id: str) -> str:
        """Derives a human-readable title for a conversation by checking its initial user prompt."""
        if not conv_id:
            return ""
        candidate = os.path.join(self.get_brain_dir(), conv_id, ".system_generated", "logs", "transcript.jsonl")
        if not os.path.exists(candidate):
            return ""
        try:
            with open(candidate, "r", encoding="utf-8", errors="ignore") as f:
                for line in f:
                    if not line.strip():
                        continue
                    d = json.loads(line)
                    if d.get("source") == "USER_EXPLICIT" or d.get("type") == "USER_INPUT":
                        raw = d.get("content") or ""
                        req_match = re.search(r"<USER_REQUEST>(.*?)</USER_REQUEST>", raw, re.DOTALL)
                        text = req_match.group(1).strip() if req_match else raw.strip()
                        lines_txt = [ln.strip() for ln in text.splitlines() if ln.strip() and not ln.strip().startswith("/")]
                        if lines_txt:
                            first_line = lines_txt[0]
                            first_line = re.sub(r"[#*`_]+", "", first_line).strip()
                            if len(first_line) > 50:
                                return first_line[:47] + "..."
                            return first_line
        except Exception:
            pass
        return ""

    def get_latest_user_input_timestamp(self, path):
        try:
            size = os.path.getsize(path)
            block_size = 65536
            max_scan = min(size, 1048576)  # scan up to 1MB from the end
            with open(path, "rb") as f:
                pos = size
                while pos > size - max_scan:
                    read_size = min(block_size, pos - (size - max_scan))
                    pos -= read_size
                    f.seek(pos)
                    chunk = f.read(read_size + 4096).decode("utf-8", errors="ignore")
                    lines = chunk.splitlines()
                    for l in reversed(lines):
                        if '"type":"USER_INPUT"' in l:
                            d = json.loads(l)
                            return d.get("created_at", "")
        except Exception:
            return ""
        return ""

    def get_ide_active_conversation_id(self):
        """Directly queries Antigravity's active Electron window via local Chrome DevTools port."""
        port_file = os.path.expanduser("~/Library/Application Support/Antigravity/DevToolsActivePort")
        if not os.path.exists(port_file):
            return None
        try:
            with open(port_file, "r") as f:
                port = f.readline().strip()
            req = urllib.request.Request(f"http://127.0.0.1:{port}/json")
            with urllib.request.urlopen(req, timeout=0.3) as res:
                targets = json.loads(res.read().decode())
            for t in targets:
                if t.get("type") == "page":
                    url = t.get("url", "")
                    m = re.search(r"/c/([0-9a-f-]{36})", url)
                    if m:
                        return m.group(1)
        except Exception:
            return None
        return None

    def set_active_conversation(self, conversation_id: str, title: str = "", force: bool = False):
        if not conversation_id:
            return
        if not force and conversation_id == self.pinned_conversation_id and self.current_path and os.path.exists(self.current_path):
            return
        candidate = os.path.join(self.get_brain_dir(), conversation_id, ".system_generated", "logs", "transcript.jsonl")
        if os.path.exists(candidate):
            logger.info(f"UI pinned active conversation: {conversation_id} ({title})")
            self.pinned_conversation_id = conversation_id
            self.switch_to_conversation(candidate, conversation_id, title=title)

    def find_active_conversation(self):
        # 1. Primary Authority: Pinned conversation from UI/client
        if self.pinned_conversation_id:
            candidate = os.path.join(self.get_brain_dir(), self.pinned_conversation_id, ".system_generated", "logs", "transcript.jsonl")
            if os.path.exists(candidate):
                return candidate

        # 2. Live Antigravity IDE Electron Window URL
        ide_conv_id = self.get_ide_active_conversation_id()
        if ide_conv_id:
            candidate = os.path.join(self.get_brain_dir(), ide_conv_id, ".system_generated", "logs", "transcript.jsonl")
            if os.path.exists(candidate):
                return candidate

        # 3. Fallback: check all conversations to see which one received the most recent user prompt
        pattern = os.path.join(self.get_brain_dir(), "*", ".system_generated", "logs", "transcript.jsonl")
        candidates = glob.glob(pattern)
        if not candidates:
            return self.current_path

        best_path = None
        best_time = ""
        for c in candidates:
            utime = self.get_latest_user_input_timestamp(c)
            if utime and utime > best_time:
                best_time = utime
                best_path = c
        return best_path or self.current_path

    def find_latest_transcript(self):
        return self.find_active_conversation()

    def switch_to_conversation(self, path, conv_id=None, title: str = ""):
        if not path or not os.path.exists(path):
            return

        target_conv_id = conv_id or path.split(os.sep)[-4]
        target_title = title.strip() or self.get_conversation_title(target_conv_id) or "another conversation"

        # Check if Butler was actively speaking when tab switch occurred
        was_speaking = self.is_speaking
        if was_speaking:
            # Stop audio playback and cancel ongoing speech task
            self.stop_current_playback()
            self.is_speaking = False
            # Save interrupted explanation to memory so developer can ask to resume
            if self.pinned_conversation_id:
                self.interrupted_summaries[self.pinned_conversation_id] = {
                    "text": self.current_speaking_summary,
                    "title": self.current_title or "the previous chat",
                }
                self.last_interrupted_conv_id = self.pinned_conversation_id
                logger.info(f"Butler interrupted mid-speech on tab switch. Saved interrupted summary for conv '{self.pinned_conversation_id}' ('{self.current_title}').")

            # Verbal announcement: announce the conversation switch out loud
            announcement = (
                f"[SYSTEM EVENT: Tab switched while you were speaking. "
                f"Immediately say out loud clearly: \"We've switched to {target_title}.\" "
                "Do not add any extra chatter; just state this one sentence out loud and pause.]"
            )
            if self.on_agent_turn_completed:
                try:
                    res = self.on_agent_turn_completed(announcement)
                    if asyncio.iscoroutine(res):
                        asyncio.create_task(res)
                except Exception as e:
                    logger.error(f"Error broadcasting switch announcement: {e}")

        # 1. Save prior conversation state if leaving one
        if self.pinned_conversation_id and self.current_path:
            self.conv_states[self.pinned_conversation_id] = {
                "last_pos": self.last_pos,
                "last_spoken_step": self.last_spoken_step,
                "last_user_input_time": self.last_user_input_time,
                "title": self.current_title,
            }

        self.current_path = path
        self.pinned_conversation_id = target_conv_id
        self.current_title = target_title

        # 2. Restore state if we've already tracked this conversation, otherwise initialize at end of file
        if target_conv_id in self.conv_states:
            saved = self.conv_states[target_conv_id]
            self.last_pos = min(saved.get("last_pos", 0), os.path.getsize(path))
            self.last_spoken_step = saved.get("last_spoken_step", -1)
            self.last_user_input_time = saved.get("last_user_input_time", "")
            logger.info(f"Restored per-chat Butler state for {target_conv_id}: last_spoken_step={self.last_spoken_step}, last_pos={self.last_pos}")
        else:
            self.last_pos = os.path.getsize(path)
            self.last_user_input_time = self.get_latest_user_input_timestamp(path)

            # Silently align last_spoken_step with the end of the file so historical responses are never spoken
            highest_step = -1
            try:
                with open(path, "r", encoding="utf-8", errors="ignore") as f:
                    for line in f:
                        line = line.strip()
                        if not line:
                            continue
                        try:
                            d = json.loads(line)
                            step = d.get("step_index")
                            if step is not None and step > highest_step:
                                highest_step = step
                        except Exception:
                            pass
            except Exception:
                pass

            self.last_spoken_step = highest_step
            self.conv_states[target_conv_id] = {
                "last_pos": self.last_pos,
                "last_spoken_step": self.last_spoken_step,
                "last_user_input_time": self.last_user_input_time,
                "title": self.current_title,
            }
            logger.info(f"Initialized per-chat Butler state for {target_conv_id} (silently aligned at step {highest_step})")

        # Notify Gemini Live of the newly focused conversation's rolling context and any interrupted context
        summary = self.get_rolling_summary(path, max_turns=5)
        if self.on_context_update:
            interrupted_block = ""
            # Check if this target tab itself has pending interrupted speech
            if target_conv_id in self.interrupted_summaries:
                my_interrupted = self.interrupted_summaries[target_conv_id]
                interrupted_text = my_interrupted.get("text", "")
                interrupted_block = (
                    f"\n[INTERRUPTED EXPLANATION MEMORY (CURRENT TAB): In this conversation ('{target_title}'), you were interrupted while explaining:\n"
                    f"\"{interrupted_text}\"\n"
                    "Because the developer is now BACK on this original tab, if the developer asks you to continue, says 'continue', 'what were you saying?', or asks to resume, "
                    "begin your spoken response with: 'As I was saying,' and seamlessly continue explaining the remaining portion without restarting from the beginning.]\n"
                )
            elif self.last_interrupted_conv_id and self.last_interrupted_conv_id != target_conv_id:
                # Interrupted on a DIFFERENT tab
                other_info = self.interrupted_summaries.get(self.last_interrupted_conv_id, {})
                other_title = other_info.get("title", "our previous chat")
                other_text = other_info.get("text", "")
                interrupted_block = (
                    f"\n[CROSS-TAB CONTINUATION DIRECTIVE: Notice that you were previously explaining something in '{other_title}':\n"
                    f"\"{other_text[:500]}\"\n"
                    f"However, the developer is currently on a DIFFERENT tab: '{target_title}'.\n"
                    "If the developer asks you to 'continue', 'what were you saying?', or asks to resume while viewing this different tab: "
                    f"DO NOT continue reciting the explanation from '{other_title}'!\n"
                    f"Instead, politely acknowledge both and ask which one they'd like to discuss by saying aloud:\n"
                    f"\"In our {other_title} chat, I was explaining [topic in 3-5 words]. But over here in {target_title}, we are working on [current chat topic in 3-5 words]. Which would you like me to discuss?\"\n"
                    "Then pause and wait for the developer's answer.]\n"
                )

            context_msg = (
                f"[SYSTEM CONTEXT: The developer has switched active focus to chat '{target_title}' (id: {self.pinned_conversation_id}).\n"
                f"Here is the recent on-screen chat history and context for this active tab:\n{summary}\n"
                f"{interrupted_block}"
                "Keep our ongoing verbal dialogue active and seamlessly pivot to discuss this chat when the developer speaks to you. "
                "Stay silent and do not speak out loud until the developer speaks to you.]"
            )
            try:
                res = self.on_context_update(context_msg)
                if asyncio.iscoroutine(res):
                    asyncio.create_task(res)
            except Exception:
                pass

    def stop_current_playback(self):
        if self.pending_speech_task and not self.pending_speech_task.done():
            self.pending_speech_task.cancel()
            self.pending_speech_task = None
            logger.info("Cancelled pending Butler speech task.")

    def initialize_state(self):
        active = self.find_active_conversation()
        if active:
            self.switch_to_conversation(active)

    async def speak_response(self, text: str, step_index: int):
        logger.info(f"Butler generating spoken ELI5 summary for step {step_index}...")

        clean_text = re.sub(r"```[\s\S]*?```", "[code snippet]", text)
        clean_text = re.sub(r"\n+", " ", clean_text)[:1200].strip()

        prompt = (
            f'[SYSTEM EVENT: The Antigravity coding agent just finished executing and outputted: "{clean_text}". '
            "As the pair-programming Butler, speak out loud to the user in 1-2 casual, friendly, spoken conversational sentences (ELI5) "
            "summarizing what was accomplished. Then ask the user if they want to review it or move to the next task.]"
        )

        config = types.LiveConnectConfig(
            response_modalities=[types.Modality.AUDIO],
            speech_config=types.SpeechConfig(
                voice_config=types.VoiceConfig(
                    prebuilt_voice_config=types.PrebuiltVoiceConfig(voice_name="Puck")
                )
            ),
            system_instruction=types.Content(parts=[types.Part(text=BUTLER_SYSTEM_INSTRUCTION)]),
        )

        pcm_chunks = bytearray()
        transcripts = []

        try:
            async with self.client.aio.live.connect(model=self.model, config=config) as session:
                await session.send_realtime_input(text=prompt)

                async for response in session.receive():
                    sc = response.server_content
                    if sc and sc.model_turn:
                        for part in sc.model_turn.parts:
                            if part.inline_data and part.inline_data.data:
                                chunk = part.inline_data.data
                                pcm_chunks.extend(chunk)
                                if self.on_audio_chunk:
                                    try:
                                        res = self.on_audio_chunk(chunk)
                                        if asyncio.iscoroutine(res):
                                            await res
                                    except Exception:
                                        pass

                    if sc and sc.output_transcription and sc.output_transcription.text:
                        txt = sc.output_transcription.text
                        transcripts.append(txt)
                        if self.on_transcript:
                            try:
                                res = self.on_transcript(txt)
                                if asyncio.iscoroutine(res):
                                    await res
                            except Exception:
                                pass

                    if sc and sc.turn_complete:
                        if self.on_turn_complete:
                            try:
                                res = self.on_turn_complete()
                                if asyncio.iscoroutine(res):
                                    await res
                            except Exception:
                                pass
                        break

            spoken_summary = "".join(transcripts).strip()
            logger.info(f"Butler spoken summary generated ({len(pcm_chunks)} bytes): \"{spoken_summary}\"")

        except asyncio.CancelledError:
            logger.info("Speech generation cancelled.")
        except Exception as e:
            logger.error(f"Failed to generate/stream Butler speech: {e}", exc_info=True)

    async def run(self):
        self.is_running = True
        self.initialize_state()

        pending_response = None
        pending_step = -1
        settle_timer = 0

        while self.is_running:
            try:
                await asyncio.sleep(0.2)

                # Check if a different conversation received a newer user input
                active_path = self.find_active_conversation()
                if active_path and active_path != self.current_path:
                    logger.info(f"Detected conversation switch -> {active_path}")
                    self.switch_to_conversation(active_path)
                    pending_response = None

                if not self.current_path or not os.path.exists(self.current_path):
                    continue

                curr_size = os.path.getsize(self.current_path)

                # If new data arrived in the active conversation
                if curr_size > self.last_pos:
                    with open(self.current_path, "r", encoding="utf-8", errors="ignore") as f:
                        f.seek(self.last_pos)
                        new_chunk = f.read()
                        self.last_pos = f.tell()

                    lines = new_chunk.strip().split("\n")
                    for line in lines:
                        line = line.strip()
                        if not line:
                            continue
                        try:
                            d = json.loads(line)
                            step = d.get("step_index")
                            if step is not None and step <= self.last_spoken_step:
                                continue

                            # Completed model turn with content and no tool calls
                            if d.get("source") == "MODEL" and d.get("type") == "PLANNER_RESPONSE" and d.get("status") == "DONE":
                                content = (d.get("content") or "").strip()
                                tool_calls = d.get("tool_calls")
                                if content and not tool_calls and len(content) > 5:
                                    pending_response = content
                                    pending_step = step
                                    settle_timer = time.time()
                                    logger.info(f"Queued latest response at step {step} (waiting 0.5s conversational settlement)...")

                            # If model made tool calls or generic step, hold speech
                            elif d.get("tool_calls") or (d.get("source") == "MODEL" and d.get("type") == "GENERIC"):
                                if pending_response is not None:
                                    logger.info("Agent still executing tool calls; holding speech.")
                                    pending_response = None

                        except Exception as err:
                            logger.debug(f"Error parsing line: {err}")

                # If candidate response settled for ~0.5s to restore crisp responsiveness
                if pending_response is not None and (time.time() - settle_timer >= 0.5):
                    to_speak = pending_response
                    step_to_speak = pending_step
                    pending_response = None
                    self.last_spoken_step = max(self.last_spoken_step, step_to_speak)
                    logger.info(f"Response settled at step {step_to_speak}. Triggering Butler speech now.")

                    clean_text = re.sub(r"```[\s\S]*?```", "[code snippet]", to_speak)
                    clean_text = re.sub(r"\s+", " ", clean_text)[:6000].strip()

                    # Extract the rich execution context (developer goal, files touched, actions taken, walkthrough)
                    task_ctx = self.extract_task_execution_context(self.current_path, step_to_speak)
                    goal_desc = task_ctx.get("user_goal", "").strip()
                    actions_list = task_ctx.get("actions", [])
                    actions_formatted = "\n".join([f"- {a}" for a in actions_list]) if actions_list else "None recorded"
                    wt = task_ctx.get("walkthrough", "")
                    wt_block = f"WALKTHROUGH ARTIFACT SUMMARY:\n{wt}\n\n" if wt else ""

                    prompt = (
                        f"[SYSTEM EVENT: The on-screen Antigravity coding agent just finished executing a task.\n"
                        f"DEVELOPER'S GOAL: {goal_desc or 'Continue previous conversation / task'}\n\n"
                        f"ACTIONS & CHANGES PERFORMED:\n{actions_formatted}\n\n"
                        f"{wt_block}"
                        f"ON-SCREEN AGENT FINAL WRITTEN RESPONSE:\n\"{clean_text}\"\n\n"
                        "INSTRUCTIONS FOR BUTLER:\n"
                        "Speak out loud as a sharp, friendly pair-programming partner sitting right next to the developer.\n"
                        "Deliver a thorough, conversational, ELI5 ('explain like I'm 5') breakdown of what was just done. "
                        "Do NOT arbitrarily limit yourself to brief 1-2 sentence summaries; take the time to be clear and informative without sounding like reading a dry novel.\n"
                        "Walk through:\n"
                        "1) The developer's goal or the underlying problem in simple terms.\n"
                        "2) Exactly what was broken, changed, or added, explaining WHY in clear plain English.\n"
                        "3) The specific files touched and key commands/tests run, citing actual outcomes casually.\n"
                        "4) Concrete advice on what to test or tackle next so the developer doesn't miss a thing.\n"
                        "Never read raw code blocks, file diffs, or markdown tables aloud; translate technical details into smooth spoken English.]"
                    )

                    self.is_speaking = True
                    self.current_speaking_summary = prompt

                    if self.on_agent_turn_completed:
                        try:
                            res = self.on_agent_turn_completed(prompt)
                            if asyncio.iscoroutine(res):
                                asyncio.create_task(res)
                        except Exception as e:
                            logger.error(f"Error calling on_agent_turn_completed: {e}")
                    else:
                        self.stop_current_playback()
                        self.pending_speech_task = asyncio.create_task(self.speak_response(to_speak, step_to_speak))

            except asyncio.CancelledError:
                break
            except Exception as e:
                logger.error(f"Error in TranscriptWatcher loop: {e}")
                await asyncio.sleep(1.0)
