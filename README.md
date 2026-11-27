# Punchline!

[Play on GitHub Pages](https://devenshah.com/Quiplash/)

Punchline is a browser party game for 3–8 players and a voting audience. Two players answer each prompt, friends choose a favorite, and the authors are revealed after voting. Round two doubles the points. In the final, everyone answers one prompt and players can stack or split three votes.

## Play with friends

1. One person opens the game and selects **Create a room**. Put that tab on a big screen or share it on a call.
2. Everyone, including the host if they want a seat, opens the invite link on a phone, scans the lobby QR code, or enters the four-letter room code. Each player chooses a name.
3. Start the game once at least three players have joined. Extra guests and late arrivals join the voting audience. Keep the host tab open through the final scores.

Each answer supports 160 characters, bold and italic text, and one embedded image. Tap **GIF** to browse trending memes or search [GifSnap](https://gifsnap.com/) by show, character, or reaction. Choose **More GIFs** for the next page of results. The picker also includes the original emoji shelf and Wikimedia Commons search. You can paste an image link or upload a picture or animation. Large uploads are resized on the device. Player refreshes in the same tab can restore a seat and an in-progress draft.

## Soundtrack and announcer

The host plays an original six-track party mix. The lobby starts with disco-funk, writing uses a swung bass groove, and voting switches to a house beat. Open **Sound booth** to adjust the music independently. The mix drops beneath speech and returns between announcements.

The announcer generates short comments on the host’s device. The host browser reads them aloud and sends the same captions to everyone in the room. Comments can refer back to earlier lines and to game events such as a tie or a sweep. Game timers continue during generation.

Leave **Use SmolLM2 for host banter** checked when creating a room to have an instruction-tuned model write the punchlines. Each request includes the game event and the previous remark. The first download is about 108 MB including the WebAssembly runtime. The host verifies the weights and caches them when browser storage is available. The checkbox starts on for desktop hosts with a suitable connection. The prepared Mac launcher loads the weights from its local `.models` directory. Players joining a room never download the model.

While SmolLM2 loads, or if the host leaves it off, a ready browser language model or the bundled word model can provide commentary immediately. Open **Sound booth → Announcer model** to change models or see which one wrote the latest line.

## Play with your installed Quiplash 2 host and music

On a Mac with The Jackbox Party Pack 3 installed in Steam, double-click **Play with Steam audio.command** in this folder. The launcher uses Python 3 and opens a private host screen in your browser. Choose **Create a room** as usual. Friends use the same public GitHub Pages link and room code. Leave the terminal and host tab open until the game ends.

The launcher reads the installed Quiplash 2 announcer recordings on the host Mac. For the original phase music, select **Sound booth → Music source → Quiplash 2 soundtrack**. The party mix is the default. It also uses the installed spoken prompts for the two head-to-head rounds. The shared final uses the Punchline prompt deck. Only the prompt being played and the live game state are shown to players. The recordings stay on the host computer.

Alternatively, a host playing directly from GitHub Pages can choose **Sound booth → Quiplash 2 recordings → Choose audio folder** and select the installed game's **Quiplash2/TalkshowExport/project/media** directory. That mode keeps the Punchline prompt deck and remembers the imported phase music and announcer cues in this browser if storage is available. Generated banter uses the browser’s voice, including when the installed recordings supply the game cues. The default web game includes original art, music, and prompts. Punchline is an independent game.

## Run or test locally

The website has no build step. With Python 3 available, run `python3 -m http.server 8080 --bind 127.0.0.1` in this folder, then open `http://127.0.0.1:8080/`. For the Steam-enabled Mac host, run the launcher above, or `python3 local_host.py`. Run the rules tests with `npm test` on Node.js 22 or later.

## Hosting and connections

GitHub Pages publishes this repository from the root of the main branch. The page uses the public PeerJS signaling service to introduce players to the host. Answers, pictures, votes and scores travel over WebRTC data channels. The host browser runs the timers and computes all scores. A refresh of the same host tab can restore room state from session storage. Closing the host ends live play.

The game requires internet access to set up rooms. Networks that block direct WebRTC or require a TURN relay can prevent a player from connecting. Trying home Wi-Fi or a mobile hotspot can help. Hosts can share the public room link from the Steam-enabled launcher. A plain localhost development link is available only on its own machine.

## Credits

The six original tracks can be rebuilt with `tools/render_soundtrack.py` using NumPy and FFmpeg. The neural announcer uses Hugging Face’s [SmolLM2-135M-Instruct](https://huggingface.co/HuggingFaceTB/SmolLM2-135M-Instruct), [GGUF quantization by bartowski](https://huggingface.co/bartowski/SmolLM2-135M-Instruct-GGUF), and [wllama](https://github.com/ngxson/wllama). Its runtime licenses are in [vendor/wllama](vendor/wllama).

The bundled GIF shelf uses Google's Animated Noto Emoji. GIF attribution and the resizer license are in [GIF credits](assets/gifs/CREDITS.md). Barlow Condensed and DM Sans are provided under the SIL Open Font License in [assets/fonts](assets/fonts). PeerJS and Kazuhiko Arase's QR generator are distributed with their notices in [vendor](vendor).
