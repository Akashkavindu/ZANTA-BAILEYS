<div align="center">
  <img src="https://raw.githubusercontent.com/WhiskeySockets/Baileys/refs/heads/master/Media/logo.png" alt="ZANTA-BAILEYS" height="90" />
  
  <h1>ZANTA-BAILEYS</h1>
  
  <p>A <b>Professional</b>, <b>Highly Optimized</b> & <b>Clean</b> WebSocket-based JavaScript library for interacting with the WhatsApp Web API.</p>
  
  <p>
    <a href="https://github.com/Akashkavindu/ZANTA-BAILEYS"><img title="Blazing Fast" src="https://img.shields.io/badge/Speed-Blazing%20Fast-orange?style=for-the-badge&logo=fastly"></a>
    <a href="https://github.com/Akashkavindu/ZANTA-BAILEYS"><img title="Version" src="https://img.shields.io/badge/Version-1.0.0-blue?style=for-the-badge"></a>
    <a href="https://github.com/Akashkavindu/ZANTA-BAILEYS/blob/main/LICENSE"><img title="License" src="https://img.shields.io/badge/License-MIT-green?style=for-the-badge"></a>
    <a href="https://github.com/Akashkavindu/ZANTA-BAILEYS"><img title="Stars" src="https://img.shields.io/github/stars/Akashkavindu/ZANTA-BAILEYS?style=for-the-badge&color=yellow"></a>
    <a href="https://github.com/Akashkavindu/ZANTA-BAILEYS"><img title="Forks" src="https://img.shields.io/github/forks/Akashkavindu/ZANTA-BAILEYS?style=for-the-badge&color=purple"></a>
    <a href="https://github.com/Akashkavindu/ZANTA-BAILEYS/issues"><img title="Issues" src="https://img.shields.io/github/issues/Akashkavindu/ZANTA-BAILEYS?style=for-the-badge&color=red"></a>
  </p>
  
  <p>
    <a href="#-overview">Overview</a> •
    <a href="#-features">Features</a> •
    <a href="#-installation">Installation</a> •
    <a href="#-connecting-your-bot">Connect Bot</a> •
    <a href="#-buttons">Buttons</a> •
    <a href="#-channel-media">Channel Media</a> •
    <a href="#-usage">Usage</a> •
    <a href="#-support">Support</a>
  </p>
</div>

---

## 🌟 Overview

**ZANTA-BAILEYS** is a modified, **100% pure & clean custom fork** of Baileys. All hidden tracking endpoints, background data collection, and annoying developer auto-follow newsletter scripts have been completely stripped out to ensure maximum privacy, safety, and background performance for your automated bots.

Optimized specifically to power the **ZANTA-MINI** WhatsApp bot framework.

> [!NOTE]
> This fork is **not** a rewrite — it's a drop-in replacement. All original Baileys APIs work exactly the same way.

---

## ⚡ Features

<div align="center">

| Feature | Description | Status |
|:---|:---|:---:|
| 📦 **2GB Large File Streaming** | Seamless streaming & direct upload/download of large files up to **2GB** without exhausting server RAM | ✅ |
| 🚀 **Deep Performance** | Lightweight structure optimized for **low-spec hosting** servers & automated business workflows | ✅ |
| 🎨 **Interactive Buttons** | Full support for **buttons**, **list messages**, **template buttons** & interactive UI | ✅ |
| 📢 **Channel Media Send** | Send images, videos, audio & documents directly to **WhatsApp Channels** | ✅ |
| ⚡ **Fast Response** | Optimized message handling for **instant replies** with minimal latency | ✅ |
| 📱 **Multi-Device** | Supports WhatsApp **Multi-Device** & Web versions | ✅ |
| 🔐 **Signal Protocol** | End-to-end encryption via **libsignal** protocol | ✅ |
| 🎭 **Custom Pairing** | Connect via **QR Code** or **Pairing Code** | ✅ |

</div>

---

## 📦 Installation

npm install @zanta/baileys

## 🔌 Connectiong

import makeWASocket, { useMultiFileAuthState } from '@zanta/baileys'
import P from 'pino'

async function startBotWithPairing() {
    const { state, saveCreds } = await useMultiFileAuthState('auth_info_baileys')

    const sock = makeWASocket({
        auth: state,
        logger: P({ level: 'silent' }),
        printQRInTerminal: false,    
        browser: ['ZANTA-BAILEYS', 'Chrome', '1.0.0']
    })

    if (!sock.authState.creds.registered) {
        const phoneNumber = '9477xxxxx' 
        const pairingCode = await sock.requestPairingCode(phoneNumber)
        console.log('🔢 Your Pairing Code:', pairingCode)
    }

    sock.ev.on('creds.update', saveCreds)

    sock.ev.on('connection.update', ({ connection }) => {
        if (connection === 'open') {
            console.log('✅ Bot connected via pairing code!')
        }
    })

    return sock
}

startBotWithPairing()

## 🔄 Auto Reconnect with Error Handling

import makeWASocket, { 
    useMultiFileAuthState, 
    DisconnectReason,
    fetchLatestBaileysVersion 
} from '@zanta/baileys'
import { Boom } from '@hapi/boom'
import P from 'pino'

async function connectToWhatsApp() {
    const { state, saveCreds } = await useMultiFileAuthState('auth_info_baileys')
    const { version } = await fetchLatestBaileysVersion()

    const sock = makeWASocket({
        version,
        auth: state,
        logger: P({ level: 'silent' }),
        printQRInTerminal: true,
        browser: ['ZANTA-BAILEYS', 'Chrome', '1.0.0'],
        defaultQueryTimeoutMs: 120000,
        connectTimeoutMs: 60000,
        enableAutoSessionRecreation: true,
        markOnlineOnConnect: false,
        syncFullHistory: false,
    })

    sock.ev.on('connection.update', (update) => {
        const { connection, lastDisconnect } = update

        if (connection === 'close') {
            const statusCode = (lastDisconnect?.error as Boom)?.output?.statusCode
            const shouldReconnect = statusCode !== DisconnectReason.loggedOut

            console.log(`❌ Disconnected. Code: ${statusCode}. Reconnecting: ${shouldReconnect}`)

            if (shouldReconnect) {
                setTimeout(() => connectToWhatsApp(), 3000)  // 3s delay එකකින් retry
            } else {
                console.log('🚪 Logged out. Please scan QR again.')
            }
        } else if (connection === 'open') {
            console.log('✅ Connected to WhatsApp!')
        }
    })

    sock.ev.on('creds.update', saveCreds)

    return sock
}

connectToWhatsApp()

## 🎨 Buttons
await sock.sendMessage(jid, {
    text: '🎯 *Choose an option:*',
    footer: 'ZANTA-BAILEYS',
    buttons: [
        {
            buttonId: 'btn_yes',
            buttonText: { displayText: '✅ Yes' },
            type: 1
        },
        {
            buttonId: 'btn_no',
            buttonText: { displayText: '❌ No' },
            type: 1
        },
        {
            buttonId: 'btn_maybe',
            buttonText: { displayText: '🤔 Maybe' },
            type: 1
        }
    ],
    headerType: 1,
    viewOnce: true
}

## 🔗 URL Buttons

await sock.sendMessage(jid, {
    text: '🌐 *Visit our website:*',
    footer: 'ZANTA-BAILEYS',
    buttons: [
        {
            buttonId: 'url_btn',
            buttonText: { displayText: '🌐 Open Website' },
            type: 1
        }
    ],
    headerType: 1
})

## 📋 List Message (Menu)

await sock.sendMessage(jid, {
    text: '📋 *Main Menu*\n\nPlease select an option below:',
    footer: '© ZANTA-BAILEYS',
    title: '🎯 Bot Menu',
    buttonText: '📂 Open Menu',
    sections: [
        {
            title: '👤 User Commands',
            rows: [
                { title: '👤 My Profile', rowId: 'cmd_profile', description: 'View your profile' },
                { title: '⚙️ Settings', rowId: 'cmd_settings', description: 'Change settings' },
                { title: '📊 Statistics', rowId: 'cmd_stats', description: 'View bot stats' }
            ]
        },
        {
            title: '🎮 Fun Commands',
            rows: [
                { title: '🎲 Roll Dice', rowId: 'cmd_dice' },
                { title: '🎰 Spin Wheel', rowId: 'cmd_spin' },
                { title: '🎯 Truth or Dare', rowId: 'cmd_tod' }
            ]
        },
        {
            title: '🛠️ Admin Commands',
            rows: [
                { title: '🔨 Ban User', rowId: 'cmd_ban' },
                { title: '📢 Broadcast', rowId: 'cmd_broadcast' }
            ]
        }
    ]
}, { quoted: m })

## 📨 Handle Button Responses

sock.ev.on('messages.upsert', async ({ messages, type }) => {
    const m = messages[0]
    if (!m.message) return

    const buttonResponse = m.message?.buttonsResponseMessage
    if (buttonResponse) {
        const selectedId = buttonResponse.selectedButtonId
        const selectedText = buttonResponse.selectedDisplayText

        console.log(`User clicked: ${selectedId} (${selectedText})`)

        switch (selectedId) {
            case 'btn_yes':
                await sock.sendMessage(m.key.remoteJid, { text: '✅ You said YES!' })
                break
            case 'btn_no':
                await sock.sendMessage(m.key.remoteJid, { text: '❌ You said NO!' })
                break
            case 'btn_maybe':
                await sock.sendMessage(m.key.remoteJid, { text: '🤔 Maybe...' })
                break
        }
    }

    const listResponse = m.message?.listResponseMessage
    if (listResponse) {
        const selectedRow = listResponse.singleSelectReply?.selectedRowId
        console.log(`User selected: ${selectedRow}`)

        if (selectedRow === 'cmd_profile') {
            await sock.sendMessage(m.key.remoteJid, { text: '👤 *Your Profile*\nName: User' })
        }
    }
    
    const templateResponse = m.message?.templateButtonReplyMessage
    if (templateResponse) {
        console.log(`Template clicked: ${templateResponse.selectedId}`)
    }
})

## 📷 Send Image to Channel

const channelJid = '120363406265537739@newsletter'

await sock.newsletterSendMedia(channelJid, {
    audio: { url: 'https://example.com/image.jpg' },
    mimetype: 'audio/ogg; codecs=opus'
})

## 💖 Send Reaction

await sock.sendMessage(jid, {
    react: {
        text: '❤️',
        key: m.key
    }
})

## 🛠️ Core API
<details> <summary><b>📨 Messaging</b></summary>

await sock.sendMessage(jid, { text: 'Hi' })           // Text
await sock.sendMessage(jid, { image: { url } })       // Image
await sock.sendMessage(jid, { video: { url } })       // Video
await sock.sendMessage(jid, { audio: { url } })       // Audio
await sock.sendMessage(jid, { document: { url } })    // Document
await sock.sendMessage(jid, { sticker: { url } })     // Sticker
await sock.sendMessage(jid, { react: { text, key } }) // Reaction
await sock.sendMessage(jid, { delete: msg.key })      // Delete
await sock.sendMessage(jid, { edit: msg.key, text })  // Edit

</details><details> <summary><b>👥 Groups</b></summary>

await sock.groupCreate(name, participants)
await sock.groupParticipantsUpdate(jid, [user], 'add')
await sock.groupUpdateSubject(jid, 'New Name')
await sock.groupUpdateDescription(jid, 'New Desc')
await sock.groupSettingUpdate(jid, 'announcement')
await sock.groupLeave(jid)
await sock.groupMetadata(jid)
await sock.groupInviteCode(jid)

## 🔐 Session Management

import { useMultiFileAuthState } from '@zanta/baileys'

const { state, saveCreds } = await useMultiFileAuthState('auth_info_baileys')

const sock = makeWASocket({ auth: state })

// Save credentials on every update
sock.ev.on('creds.update', saveCreds)

##📚 Documentation

Events
Event	                             Description
connection.update	                 Connection state changes (open, close, connecting)
creds.update	                     Authentication credentials updated
messages.upsert	                   New messages received
messages.update                    Message status updates (read, delivered)
message-receipt.update	           Read receipts
groups.update	                     Group metadata changes
group-participants.update	         Group members added/removed/promoted
call	                             Incoming call events
presence.update	                   Contact presence (online, typing)

## 🙏 Credits

Original Baileys by @WhiskeySockets
libsignal by @signal
All contributors who made this project possible

## ⚠️ Disclaimer

This project is not affiliated, associated, authorized, endorsed by, or in any way officially connected with WhatsApp or any of its subsidiaries or affiliates.
The official WhatsApp website can be found at whatsapp.com. "WhatsApp" as well as related names, marks, emblems and images are registered trademarks of their respective owners.
Use at your own discretion. Do not spam people with this. We discourage any stalkerware, bulk or automated messaging usage.

