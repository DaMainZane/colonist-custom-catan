# 🏝️ Colonist Custom — Online Multiplayer Hex Board Game

![Node.js](https://img.shields.io/badge/Node.js-18%2B-339933?logo=nodedotjs&logoColor=white)
![Socket.io](https://img.shields.io/badge/Socket.io-4.7-010101?logo=socketdotio&logoColor=white)
![Express](https://img.shields.io/badge/Express-4.19-000000?logo=express&logoColor=white)
![AI](https://img.shields.io/badge/Bot_AI-Advanced_Hard-ff9800)
![License](https://img.shields.io/badge/License-MIT-blue)

A fast, lightweight, and fully customizable online multiplayer Catan-style board game modeled after **Colonist.io**. Built with **Node.js**, **Express**, **Socket.io**, and pure **SVG/HTML5**—requiring zero external asset downloads or database setup.

---

## ✨ Features

### 🧠 Advanced Hard Bot AI (`HARD` Difficulty)
* **Strategic Snake-Draft Placement**: Evaluates every intersection by pip probability (`2–12`), Gold tile value, 5-resource diversity coverage, `Wheat+Ore` / `Wood+Brick` synergies, and Maritime Port synergies, then aims its starting road toward the highest-scoring expansion spot.
* **Goal-Driven Resource Management**: Dynamically calculates the shortest path to its next **City**, **Settlement**, **Development Card**, or **Road**, locking needed cards and using surplus cards for trades or `7`-roll discards.
* **Smart Gold & Development Card Play**: Picks the exact missing resource needed for an immediate build from Gold tiles or *Year of Plenty*, plays *Knights* before rolling if blocked by the Robber, targets the resource most held by opponents with *Monopoly*, and places the Robber on the leading player's highest-probability hex.
* **Intelligent Bot Trading & Leader Blocking**: Bots evaluate your trade offers in real time, accept trades that complete their builds or give favorable ratios, propose `1-for-1` trades on their own turns when 1 card away from a build, and **refuse to trade with players who are close to winning**.

### 🤝 Complete Colonist.io Trading System
* **Inline Trade Drawer**: Click any card in your hand (or click **⇄ Trade**) to open the bottom-left trade creator without blocking the board.
* **Dual Trade Buttons**:
  * **🏦✔ Bank / Port Trade**: Automatically detects your `4:1` Bank, `3:1` Generic Port, and `2:1` Resource Port ratios.
  * **👥✔ Player & Bot Trade**: Broadcasts your offer to all human players and Hard Bots.
* **Live Trade Response Panel**: Watch players and bots evaluate your offer in real time (`⏳` Thinking → `✔` Accepted or `✖` Declined). Click any accepting player's colored **`✔`** button to finalize the swap with them.

### 🎨 Live Sandbox Map Painter
* **Sculpt Any Map**: Click or drag directly on the board in the lobby to paint **Wood, Brick, Sheep, Wheat, Ore, Gold, Desert**, or **Ocean (Erase)** tiles to create custom islands, lakes, and archipelagos.
* **Custom Numbers, Ports & Robber**: Freely place **Number Tokens (`2`–`12`)**, **Sailboat Ports (`3:1` and `2:1`)**, and the **Robber's starting tile**.
* **1-Click Presets**: *Standard*, *Gold Rush*, *Archipelago Islands*, and *Blank Ocean*.

### 🪙 Gold Resource Tiles
* Just like in Colonist.io / Seafarers, when a Gold hex's number is rolled, players with adjacent Settlements (`+1`) or Cities (`+2`) get an inline prompt to pick **any resource of their choice**.

### 🃏 Fully Customizable Cards & Rules
* **Bank Resource Cards**: Set the exact number of cards per resource in the bank (default `19` each, customizable up to `999`) with live bank depletion tracking.
* **Development Card Deck**: Individually customize the number of **Knights**, **Victory Point Cards**, **Road Building**, **Year of Plenty**, and **Monopoly** cards.
* **Game Rules**: Customize **Map Size** (Mini 7, Standard 19, Large 37, Mega 61 hexes), **Victory Points to Win** (`3–50`), **Max Players** (`2–8`), **7-Roll Discard Limit**, and **Max Roads / Settlements / Cities** per player.

---

## 📁 Project Structure

```text
├── package.json        # Dependencies (express, socket.io)
├── server.js           # Multiplayer game engine, Hard Bot AI, trade engine & map topology builder
└── public/
    └── index.html      # Single-page Colonist.io UI, SVG renderer, trade panel & Map Painter
```

---

## 🚀 Quick Start (Run Locally)

1. **Clone the repository**:
   ```bash
   git clone https://github.com/YOUR_USERNAME/YOUR_REPO_NAME.git
   cd YOUR_REPO_NAME
   ```

2. **Install dependencies**:
   ```bash
   npm install
   ```

3. **Start the server**:
   ```bash
   npm start
   ```

4. **Play**:
   Open [http://localhost:3000](http://localhost:3000) in your browser.

---

## 🌐 How to Host Online for Free

### Option 1: Instant Public Link from Your PC (No Account Needed)
While `npm start` is running, open a second terminal and run:
```bash
npx localtunnel --port 3000
```
*(Or use `npx cloudflared tunnel --url http://localhost:3000`)*. Share the generated `https://...` URL with your friends so they can join your room immediately.

### Option 2: Permanent Free Cloud Hosting on Render.com
1. Push this repository to GitHub.
2. Create a free account at [Render.com](https://render.com/) and click **New +** → **Web Service**.
3. Connect your GitHub repository and use these settings:
   * **Environment**: `Node`
   * **Build Command**: `npm install`
   * **Start Command**: `npm start`
   * **Instance Type**: `Free`
4. Click **Create Web Service**. Render will give you a live `https://your-game-name.onrender.com` link.

---

## 🎮 Controls & How to Play

* **Invite Friends**: Click the **🔗** button in the top-left corner to copy a direct invite link with your Room Code pre-filled.
* **Trading**:
  1. On your turn, click **⇄ Trade** (or click any resource card in your hand).
  2. Click the resource icons at the top of the drawer for what you **Want (`⬇`)**, and click cards in your hand for what you **Give (`⬆`)**.
  3. Click **`🏦✔`** for an instant Bank/Port trade, or **`👥✔`** to send the offer to players and Hard Bots.
  4. When a player or bot shows **`✔`** in the top-right trade box, click their colored **`✔`** button to complete the trade!
* **Zoom & Pan**:
  * **Scroll Wheel**: Zoom in and out on the island.
  * **Right-Click + Drag** *(or `Alt` + Left-Click Drag)*: Pan the camera around the board.
  * **🔍 Button (Top-Left)**: Reset camera zoom and center the board.
* **Customizing the Map & Cards**:
  * In the lobby, use the **🎨 Map Painter** tab to select a terrain, number, robber, or port brush, then click (or drag) across the board.
  * Switch to the **🃏 Card & Resource Amounts** tab to customize bank cards, development cards, victory points, and player limits.

---

## 📜 License

This project is open-source and available under the [MIT License](LICENSE).


