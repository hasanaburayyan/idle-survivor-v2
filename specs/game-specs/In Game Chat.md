## Status
**Implemented:** global, party, and whisper tabs (server views `myGlobalChat` / `myPartyChat` / `myWhispers`; client `ChatTab.tsx`). Tab open/close + `/global`, `/party` style commands work. Scrolling history works.
**Pending:** the guild tab is in the UI as a placeholder ("Join a guild to enable this chat") but no guild backend exists yet. The guild chat view + reducers will land alongside the broader guild system (see `Social Systems.md`).

## Overview
Players are now able to chat with each other via a chat window. The chat window is tabbed consisting of global/party/guild/whisper. Each tab contains a different stream of messages and depending on which tab is open the player can send messages there. Whisper tabs are user to user and can have many of them. 

Chat tabs are removable by hitting the x in the top right of the chat. To get it back you can type /global, /party, etc..

Chat windows are also scrolling windows that contain history.