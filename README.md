# AnalogAir (My Own Private Audio) 💽 📡

> **Turn your Raspberry Pi into an intelligent, audiophile-grade Vinyl & Analog AirPlay / Multi-Room Streaming Station with automated track recognition and real-time DSP tone controls.**

AnalogAir bridges your physical analog turntable, phono stage, or cassette deck into your modern wireless audio ecosystem (AirPlay, AirPlay 2, Chromecast, and local networked speakers) using [OwnTone](https://owntone.github.io/owntone-server/), PipeWire, and a reactive dark-mode web control center.

---

## ✨ Features

- 🎵 **Lossless 16-bit / 44.1kHz Multi-Room Streaming**: Broadcasts analog audio to AirPlay, AirPlay 2, Apple TV, HomePods, Sonos (via AirPlay), and Chromecast speakers with synchronous multi-room playback.
- ⚡ **Real-Time 3-Band Shelf Equalizer**: Adjust Bass, Mid, and Treble with high-fidelity DSP filters directly from the web interface.
- 🎚️ **Zero-Latency Hardware & Software Gain Attenuation**: Prevent input clipping before digital capture occurs using ALSA hardware mixers and PipeWire/PulseAudio software capture scaling (`pactl` & `pavucontrol`).
- 🎛️ **Universal Soundcard Selector**: Works out-of-the-box with *any* USB soundcard, audio hat, USB turntable, or line-in interface (e.g., Audio-Technica, Conexant CX231xx, Behringer UCA202, Focusrite Scarlett, HiFiBerry).
- 🔍 **Real-Time Track Recognition**: Listens via acoustic fingerprinting (Shazam engine with Python 3.13 support) to identify tracks as the needle plays, fetching high-resolution album artwork and metadata.
- ⭐ **Auto-Connect Starred Speakers**: Star your favorite speakers in the web dashboard, and AnalogAir will automatically connect and resume playback upon system boot.
- 💻 **Modern Web Dashboard**: Mobile-responsive, dark-mode turntable interface displaying live needle state, audio level VU meters, track history, playback controls, and system service diagnostics.
- 🔄 **Headless Background Services**: Managed completely via systemd user services (`analogair-capture`, `analogair-daemon`, `analogair-web`) with user lingering enabled.

---

## 🛠️ Hardware Requirements

1. **Raspberry Pi**: Raspberry Pi 3B+, 4B, 5, or Zero 2 W running **Raspberry Pi OS (Bookworm or Trixie / Debian 12 or 13)**.
2. **Audio Input Device**: Any USB audio capture interface, turntable with built-in USB output, or an analog line-in HAT (e.g., HiFiBerry DAC+ ADC).
3. **Turntable / Audio Source**: With built-in phono preamp or connected through an external phono stage.
4. **Network**: Connected to the same Wi-Fi or Ethernet network as your AirPlay / Chromecast speakers.

---

## 🚀 Installation

Installation is fully automated. You only need to clone the repository and run the installation script.

### Step 1: Clone the Repository
Open a terminal on your Raspberry Pi (or connect via SSH) and run:

```bash
git clone https://github.com/Distearth/MyOwnPrivateAudio-AnalogAir.git
cd MyOwnPrivateAudio-AnalogAir
```

### Step 2: Run the Automated Installer
Make the installer executable and launch it:

```bash
chmod +x install.sh
./install.sh
```

### What the installer handles automatically:
- Installs audio architecture packages: `pipewire`, `wireplumber`, `pipewire-pulse`, `alsa-utils`, `ffmpeg`, `pulseaudio-utils`, and `pavucontrol`.
- Configures the official OwnTone repository, keyring, and sets up the lossless FIFO turntable pipe at `~/Music/AnalogAir/AnalogAir`.
- Creates an isolated Python virtual environment with Python 3.13 compatibility (`audioop-lts`, `shazamio`, `sounddevice`, `numpy`).
- Deploys the systemd services (`analogair-capture.service`, `analogair-daemon.service`, `analogair-web.service`) and enables lingering so background playback starts automatically on boot.

---

## 🌐 Accessing the Dashboard

Once the installation completes, open any web browser on your phone, tablet, or computer connected to the same local network:

- **Local hostname**: `http://analogair.local:3000`
- **Or via Pi IP**: `http://<your-pi-ip>:3000`

OwnTone's native web player is also accessible at:
- `http://<your-pi-ip>:3689`

---

## 🔄 Updating AnalogAir to Latest GitHub Version

When updates are pushed to GitHub, services should always be stopped prior to updating to prevent file locks or collisions with the active audio FIFO pipe (`~/Music/AnalogAir/AnalogAir`) and Python processes. Once updated, services are safely restarted.

### Method 1: Automated 1-Command Update (Recommended)

AnalogAir includes an automated update script (`update.sh`) that stops background services, pulls the latest commits from Git, syncs virtual environment dependencies and web assets, and restarts the services:

```bash
cd ~/MyOwnPrivateAudio-AnalogAir
chmod +x update.sh
./update.sh
```

Or run directly in a single chained terminal line:
```bash
systemctl --user stop analogair-capture analogair-daemon analogair-web && cd ~/MyOwnPrivateAudio-AnalogAir && git pull origin main && ./install.sh && systemctl --user restart analogair-capture analogair-daemon analogair-web
```

### Method 2: Step-by-Step Manual Update

If you prefer to perform each step manually:

1. **Stop active background services**:
   ```bash
   systemctl --user stop analogair-capture.service analogair-daemon.service analogair-web.service
   ```
2. **Pull the latest code from GitHub**:
   ```bash
   cd ~/MyOwnPrivateAudio-AnalogAir
   git pull origin main
   ```
3. **Update dependencies and sync scripts**:
   ```bash
   chmod +x install.sh
   ./install.sh
   ```
4. **Reload systemd and restart services**:
   ```bash
   systemctl --user daemon-reload
   systemctl --user restart analogair-capture.service analogair-daemon.service analogair-web.service
   ```
5. **Verify service status**:
   ```bash
   systemctl --user status analogair-web.service
   ```

---

## 🖥️ Boot Modes: Headless vs. Desktop with Auto-Login

AnalogAir can run either as a headless dedicated audio appliance (saving RAM and CPU) or boot directly into the Raspberry Pi OS desktop with auto-login (ideal for an HDMI screen or official Raspberry Pi Touchscreen mounted next to your turntable).

### Option A: Switching to Headless Mode (Console Autologin)
Headless mode turns off the graphical desktop environment to free ~400MB of RAM and reduce CPU overhead:

- **Quick CLI command**:
  ```bash
  sudo raspi-config nonint do_boot_behaviour B2
  sudo reboot
  ```
- **Via interactive menu**:
  1. Run `sudo raspi-config`
  2. Navigate to **1 System Options** &rarr; **S5 Boot / Auto Login**
  3. Select **B2 Console Autologin**
  4. Select **Finish** and reboot.

### Option B: Returning to Desktop Mode with Auto-Login (Desktop Autologin)
If you connect an HDMI monitor, TV, or Raspberry Pi Touchscreen to display the live spinning vinyl artwork and album covers full-screen, switch back to desktop auto-login:

- **Quick CLI command**:
  ```bash
  sudo raspi-config nonint do_boot_behaviour B4
  sudo reboot
  ```
- **Via interactive menu**:
  1. Run `sudo raspi-config`
  2. Navigate to **1 System Options** &rarr; **S5 Boot / Auto Login**
  3. Select **B4 Desktop Autologin**
  4. Select **Finish** and reboot.

> **💡 Touchscreen Kiosk Tip**: In Desktop mode, you can launch Chromium in full-screen kiosk mode pointing to `http://localhost:3000` to turn your Raspberry Pi and touchscreen into a dedicated vinyl now-playing display!

---

## 🎧 How to Use

1. **Drop the Needle**: Start playing a record on your turntable.
2. **Recognition Modes (Resource Saver vs. Live Album Identification)**:
   - **Default Mode (No Recognition / Resource Saver)**: Upon installation, AnalogAir defaults to Resource Saver Mode. Music streams immediately through PipeWire to OwnTone and your AirPlay speakers with **zero CPU/RAM overhead**. The screen displays your default turntable art and custom labels, and no Shazam lookups or listening history logs are performed. This ensures low-power boards (Raspberry Pi Zero, 1, 2, 3) operate with maximum responsiveness.
   - **Enable Live Album Identification**: When you are ready for automatic vinyl identification, open the dashboard at `http://<your-pi-ip>:3000`, click **Controls**, and in either the **Now Playing** tab or the **Settings** tab, toggle **Enable Album Identification** on. AnalogAir will now use Shazam acoustic fingerprinting and MusicBrainz to automatically detect album covers and save records to the **Played Albums** tab.
3. **Select Speakers**: Open the AnalogAir dashboard at `http://<your-pi-ip>:3000`, go to the **Speakers** tab, and toggle your AirPlay or Chromecast speakers on.
4. **Auto-Connect**: Click the ⭐ star next to any speaker to set it as an auto-connect target every time your Raspberry Pi boots.
5. **Tone & Gain Controls**:
   - Go to the **Tone** tab in the dashboard.
   - Choose your audio input card from the **Active Audio Capture Interface** dropdown.
   - **Line Level Input Monitor**: Toggle on the **Line Level Input Monitor** near the gain controls to test your turntable signal hotness. A studio-grade LED ladder meter displays average RMS and peak dBFS (-48 to 0 dBFS) with color-coded safety zones (green safe, amber optimal sweet spot, red clipping risk).
     > *Note*: Due to PipeWire and ALSA audio driver buffering, meter readings reflect recent capture (~2–4 seconds delay) rather than instantaneous zero-latency peaks. Play a loud section of your vinyl record, verify that peaks stay in the optimal range (-12 to -3 dBFS) without hitting red (0 dBFS / clipping), and turn the monitor off when finished to keep Raspberry Pi CPU usage at 0%.
   - Adjust the **Input Preamp** slider to achieve optimal signal strength without analog or digital clipping.
   - Fine-tune your sound with the **Bass**, **Mid**, and **Treble** sliders.

---

## 🔧 Useful Commands & Troubleshooting

### Check Background Services Status
```bash
systemctl --user status analogair-web.service
systemctl --user status analogair-capture.service
systemctl --user status analogair-daemon.service
```

### View Live Real-Time Logs
```bash
# View audio capture and tone filter logs
journalctl --user -u analogair-capture -f

# View live track identification logs
journalctl --user -u analogair-daemon -f

# View web server API logs
journalctl --user -u analogair-web -f
```

### Restart Services
```bash
systemctl --user restart analogair-capture.service
systemctl --user restart analogair-daemon.service
systemctl --user restart analogair-web.service
```

### Inspect Audio Capture in Desktop GUI
If you have a monitor or VNC connected to your Raspberry Pi desktop, you can launch the PulseAudio volume control mixer:
```bash
pavucontrol
```

---

## 📜 Architecture Overview

```
[ Analog Turntable ]
         │ (RCA / USB)
         ▼
[ USB Soundcard / ALSA / PipeWire ]
         │
         ▼
[ capture_pipe.sh (FFmpeg 3-band Shelf EQ DSP) ]
         │ (Lossless 16-bit 44.1kHz PCM)
         ▼
[ FIFO Pipe: ~/Music/AnalogAir/AnalogAir ]
         │
         ▼
[ OwnTone Media Server ] ──────────────► [ AirPlay / Chromecast Multi-Room Speakers ]
         │
         ├─────────────────────────────► [ analogair-daemon (Acoustic Fingerprinting / Shazam) ]
         │
         ▼
[ AnalogAir Web UI & Node/Python Bridge (Port 3000) ]
```

---

## 🤝 Contributing & Support

Issues, pull requests, and feature requests are welcome!
Visit the GitHub repository: [https://github.com/Distearth/MyOwnPrivateAudio-AnalogAir](https://github.com/Distearth/MyOwnPrivateAudio-AnalogAir)

---

## 📄 License

Open-source under the MIT License.
