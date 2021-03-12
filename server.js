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
	// res.json([])

	// res.send([
	//   { urls: [ "stun:sp-turn1.xirsys.com" ] },
	//   {
	//      username: "kg_6QZIwAbd4M1wSm3cmWkajkf5O9khy1WkeigO0F-hU1VDReaCTXMD3o2CEIkQEAAAAAF-SQThkcmFwcA==",
	//      credential: "48814f3a-14d8-11eb-bb10-0242ac140004",
	//      urls: [
	//          "turn:sp-turn1.xirsys.com:80?transport=udp",
	//          "turn:sp-turn1.xirsys.com:3478?transport=udp",
	//          "turn:sp-turn1.xirsys.com:80?transport=tcp",
	//          "turn:sp-turn1.xirsys.com:3478?transport=tcp",
	//          "turns:sp-turn1.xirsys.com:443?transport=tcp",
	//          "turns:sp-turn1.xirsys.com:5349?transport=tcp"
	//      ]
	//   }
	// ])

})

app.get(['/', '/:room', '*'], (req, res) =>
  res.sendFile(path.join(__dirname, 'www/index.html'))
)

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
