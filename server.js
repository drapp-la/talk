const express = require('express')
const path = require('path')
const http = require('http')
const socket = require('socket.io')

const app = express()
const server = http.createServer(app)
const io = socket.listen(server)

const {
  PORT = 3000
} = process.env

app.use(express.static(path.join(__dirname, 'www')))

app.get(['/', '/:room'], (req, res) =>
  res.sendFile(path.join(__dirname, 'www/index.html'))
)

server.listen(PORT, '0.0.0.0', () =>
  console.log(`Ready port: ${PORT}`)
)

const channels = {};
const sockets = {};

io.sockets.on('connection', socket => {
	const socketHostName = socket.handshake.headers.host.split(':')[0];

	socket.channels = {};
	sockets[socket.id] = socket;

	console.log('[' + socket.id + '] connection accepted');
	socket.on('disconnect', () => {
		for (const channel in socket.channels) {
			part(channel);
		}
		console.log('[' + socket.id + '] disconnected');
		delete sockets[socket.id];
	});

	socket.on('join', config => {
		console.log('[' + socket.id + '] join ', config);
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
		console.log('[' + socket.id + '] relay ICE-candidate to [' + peer_id + '] ', ice_candidate);

		if (peer_id in sockets) {
			sockets[peer_id].emit('iceCandidate', { peer_id: socket.id, ice_candidate: ice_candidate });
		}
	});

	socket.on('relaySessionDescription', config => {
		let peer_id = config.peer_id;
		let session_description = config.session_description;
		console.log(
			'[' + socket.id + '] relay SessionDescription to [' + peer_id + '] ',
			session_description
		);

		if (peer_id in sockets) {
			sockets[peer_id].emit('sessionDescription', {
				peer_id: socket.id,
				session_description: session_description
			});
		}
	});
});
