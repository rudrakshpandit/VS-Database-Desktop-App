# VS Database 2.0 - Production Installers (Build Latest)

Generated: Version 2.2.1 (Tauri 2 Native Architecture)

## Installers Included:

1. **VS Database Host_2.2.1_x64-setup.exe**
   - **Role:** Authoritative Central Server & Master SQLite Vault.
   - **Where to Install:** The designated Master Server PC in your office.
   - **Features:** Auto-starts local server, handles master authentication, data storage, backups, and real-time LAN sync.

2. **VS Database Client_2.2.1_x64-setup.exe**
   - **Role:** Lightweight Workstation Application.
   - **Where to Install:** Office staff workstations on the local network (LAN).
   - **Features:** Ultra-fast startup (<10 MB footprint), instant pairing with Host via auto-generated 6-digit PIN.

## Setup Instructions:
1. First, install and launch **VS Database Host** on your Main/Host PC.
2. Complete the Master Administrator registration (configured once).
3. On staff PCs, install and launch **VS Database Client**.
4. Enter Host IP/Hostname, click Register. The Host will approve and display a 6-digit PIN.
5. Enter the PIN on the client to log in. You only need to do this once per device!
