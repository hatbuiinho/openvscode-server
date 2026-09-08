# Codex Task Organizer

Codex Task Organizer is an OpenVSCode built-in extension that groups existing chat sessions into user-defined projects. It stores only display metadata and opens the original session in the native Chat Editor.

The extension relies on the private OpenVSCode commands `_openvscode.agentSessions.list` and `_openvscode.agentSessions.openEditor`. Conversation content remains owned by the original chat session provider.
