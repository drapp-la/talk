const express = require('express')
const path = require('path')
const http = require('http')
const socket = require('socket.io')
const cors = require('cors')
const fetch = require('node-fetch')

const app = express()
const server = http.createServer(app)
const io = socket.listen(server)

const {
  PORT = 3000,
  XIRSYS_API_KEY,
} = process.env

app.use(cors())
app.use(express.static(path.join(__dirname, 'www')))

server.listen(PORT, () =>
  console.log(`Ready port: ${PORT}`)
)

app.get('/iceServers', async (req, res) => {
	res.send([
	  { urls: [ "stun:stun.drapp.la:5349" ] },
	  {
	     username: "pepu",
	     credential: "12345",
	     urls: [
	         "turn:turn.drapp.la:3478?transport=udp",
	         "turn:turn.drapp.la:3478?transport=tcp",
	         "turns:turn.drapp.la:5349?transport=udp",
	         "turns:turn.drapp.la:5349?transport=tcp"
	     ]
	  }
	])
	/*
	let channel = 'meet'
	const date = new Date().toISOString().substr(0, 10)
	try {
		const url = new URL(req.get('referer'))
		channel = url.pathname.substr(1)
		const [database, apptID] = Buffer.from(decodeURIComponent(channel), 'base64').toString().split(':')
		if (/^userdb-/.test(database)) {
			channel = database
		}
	} catch {}

	const ns = await fetch(`https://drapp:${XIRSYS_API_KEY}@global.xirsys.net/_ns/${channel}`, {
		method: 'PUT',
		headers: {
			'Content-Type': 'application/json',
		},
	}).then(res => res.json()).catch(() => null)

	if (!ns || !ns.v  || (ns.v !== 'path_exists' && !ns.v._ver_)) {
		channel = 'meet'
	}

	const { s, v } = await fetch(`https://drapp:${XIRSYS_API_KEY}@global.xirsys.net/_turn/${channel}`, {
		method: 'PUT',
		headers: {
			'Content-Type': 'application/json',
		},
		body: JSON.stringify({
			format: 'urls',
			expire: 600
		})
	}).then(res => res.json()) || {}

	if (!s || s !== 'ok' || !v || !v.iceServers) return res.json([])
	res.send([v.iceServers])

	res.send([
	  { urls: [ "stun:sp-turn1.xirsys.com" ] },
	  {
	     username: "kg_6QZIwAbd4M1wSm3cmWkajkf5O9khy1WkeigO0F-hU1VDReaCTXMD3o2CEIkQEAAAAAF-SQThkcmFwcA==",
	     credential: "48814f3a-14d8-11eb-bb10-0242ac140004",
	     urls: [
	         "turn:sp-turn1.xirsys.com:80?transport=udp",
	         "turn:sp-turn1.xirsys.com:3478?transport=udp",
	         "turn:sp-turn1.xirsys.com:80?transport=tcp",
	         "turn:sp-turn1.xirsys.com:3478?transport=tcp",
	         "turns:sp-turn1.xirsys.com:443?transport=tcp",
	         "turns:sp-turn1.xirsys.com:5349?transport=tcp"
	     ]
	  }
	])
	*/

})

app.get(['/', '/:room', '*'], (req, res) => {
	const HOSTS = ['meet.drapp.la', 'meet.wiri.la']
	if (!HOSTS.includes(req.hostname) && req.path && req.path !== '/') {
		return res.redirect(`https://meet.drapp.la${req.path}#roomName=Videoconsulta&interfaceConfig.TOOLBAR_BUTTONS=%5B%22microphone%22%2C%22camera%22%2C%22desktop%22%2C%22hangup%22%2C%22invite%22%2C%22fodeviceselection%22%2C%22chat%22%2C%22security%22%5D&interfaceConfig.SETTINGS_SECTIONS=%5B%22devices%22%2C%22language%22%5D&interfaceConfig.TOOLBAR_ALWAYS_VISIBLE=false&interfaceConfig.DEFAULT_LOCAL_DISPLAY_NAME=%22yo%22&interfaceConfig.SHOW_JITSI_WATERMARK=false&interfaceConfig.SHOW_WATERMARK_FOR_GUESTS=false&interfaceConfig.SHOW_BRAND_WATERMARK=false&interfaceConfig.SHOW_POWERED_BY=false&interfaceConfig.HIDE_INVITE_MORE_HEADER=true&interfaceConfig.DEFAULT_REMOTE_DISPLAY_NAME=%22Anonimo%22&interfaceConfig.INVITATION_POWERED_BY=false&interfaceConfig.LANG_DETECTION=true&interfaceConfig.SHOW_DEEP_LINKING_IMAGE=false&interfaceConfig.VIDEO_LAYOUT_FIT=both&interfaceConfig.SHOW_CHROME_EXTENSION_BANNER=false&interfaceConfig.ENABLE_DIAL_OUT=false&interfaceConfig.DEFAULT_BACKGROUND=%23000&userInfo.displayName=%22yo%22`)
	}
  res.sendFile(path.join(__dirname, 'www/index.html'))
})

const channels = {};
const sockets = {};

io.sockets.on('connection', socket => {
	const socketHostName = socket.handshake.headers.host.split(':')[0];

	socket.channels = {};
	sockets[socket.id] = socket;

	socket.on('disconnect', () => {
		for (const channel in socket.channels) {
			part(channel);
		}
		delete sockets[socket.id];
	});

	socket.on('join', config => {
		const channel = socketHostName + config.channel;

		// Already Joined
		if (channel in socket.channels) return;

		if (!(channel in channels)) {
			channels[channel] = {};
		}

		for (id in channels[channel]) {
			channels[channel][id].emit('addPeer', { peer_id: socket.id, should_create_offer: false });
			socket.emit('addPeer', { peer_id: id, should_create_offer: true });
		}

		channels[channel][socket.id] = socket;
		socket.channels[channel] = channel;
	});

	const part = channel => {
		// Socket not in channel
		if (!(channel in socket.channels)) return;

		delete socket.channels[channel];
		delete channels[channel][socket.id];

		for (id in channels[channel]) {
			channels[channel][id].emit('removePeer', { peer_id: socket.id });
			socket.emit('removePeer', { peer_id: id });
		}
	};

	socket.on('relayICECandidate', config => {
		let peer_id = config.peer_id;
		let ice_candidate = config.ice_candidate;

		if (peer_id in sockets) {
			sockets[peer_id].emit('iceCandidate', { peer_id: socket.id, ice_candidate: ice_candidate });
		}
	});

	socket.on('relaySessionDescription', config => {
		let peer_id = config.peer_id;
		let session_description = config.session_description;
		if (peer_id in sockets) {
			sockets[peer_id].emit('sessionDescription', {
				peer_id: socket.id,
				session_description: session_description
			});
		}
	});
});
