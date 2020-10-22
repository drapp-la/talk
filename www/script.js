let USE_AUDIO = true
let USE_VIDEO = true
let CAMERA = 'user'
//let USE_VIDEO = { facingMode: "environment" } // use this for back facing camera.
let IS_SCREEN_STREAMING = false
let peerConnection
let signalingSocket
let localMediaStream
let peers = {}
let peerMediaElements = {}
const tickers = {}
const ICE_SERVERS = [
  { urls: 'stun:stun.l.google.com:19302' }
]
const resize = () => {
  const $videos = document.querySelector('.SimpleVideoApp--videos')
  if (!$videos) return
  const items = $videos.querySelectorAll('.SimpleVideoApp--video:not(.SimpleVideoApp--video-me)').length
  try {
    if (parseInt($videos.getAttribute('data-items')) === items) return
  } catch {}

  $videos.setAttribute('data-items', items.toString())
}

tickers.resize = setInterval(() => {
  try {
    resize()
  } catch {
    clearTimeout(tickers.resize)
  }
}, 350)

const notify = (html, id, ms = 5000) => {
  const $container = document.getElementById('SimpleVideoApp')
  try {
    document.querySelector(id).remove()
  } catch {}

  document.querySelector('.SimpleVideoApp--notifications').innerHTML += html

  clearTimeout(tickers[id])
  tickers[id] = setTimeout(() => {
  	try {
  		document.querySelector(id).remove()
  	} catch {}
  }, ms)
}

const copy = async text => {
  const $container = document.getElementById('SimpleVideoApp')
  try {
    await navigator.clipboard.writeText(text)
  } catch {
    try {
      const $input = $container.querySelector('input.SimpleVideoApp--copy')
      $input.value = text
      $input.select()
      try {
        $input.setSelectionRange(0, 99999)
      } catch {}
      document.execCommand('copy')
    } catch {
      return false
    }
  }
  return true
}

window.SimpleVideoApp = (params = {}) => {
	if (signalingSocket) return
  const server = params.server || location.origin
  const iceServers = params.iceServers || ICE_SERVERS
  let channel = params.channel
  if (!channel && location.origin === server) {
    channel = location.pathname.substring(1)
  }
  channel = channel || Math.random().toString(36).substr(2, 6)
  const url = `${server}/${channel}`
  if (location.origin === server && location.href !== url) {
    window.history.pushState({ url }, channel, url)
  }

  if (!window.io) {
    const script  = document.createElement('script')
    const head = document.head || document.getElementsByTagName('head')[0]
    script.src = `${server}/socket.io/socket.io.js`
    script.onload = () => SimpleVideoApp(params)
    head.appendChild(script)
    return false
  }

  console.log('Connecting to signaling server')
  signalingSocket = window.io(server)

  let $container = document.getElementById('SimpleVideoApp') || document.createElement('div')
  if (!$container.id) {
    $container.id = 'SimpleVideoApp'
    document.body.appendChild($container)
  }

  const $html = `
    <link rel="stylesheet" href="${server}/style.css" type='text/css' />
    <div class="SimpleVideoApp--message">Habilite la camara y el microfono para realizar la videconsulta</div>
    <div class="SimpleVideoApp--notifications"></div>
    <div class="SimpleVideoApp--buttons">
      <button data-action="copy" title="Copiar link de la reunion" class="fas fa-copy"></button>
      <button class="SimpleVideoApp--muteAudio fas fa-fw fa-microphone"></button>
      <button class="SimpleVideoApp--muteVideo fas fa-fw fa-video"></button>
      <button class="SimpleVideoApp--swapCamera fas fa-fw fa-sync-alt"></button>
      <button class="SimpleVideoApp--screenShare fas fa-fw fa-desktop"></button>
    </div>
    <input type="text" class="SimpleVideoApp--copy" />
    <div class="SimpleVideoApp--videos"></div>
  `

  $container.innerHTML = $html

  $container.querySelector('.SimpleVideoApp--buttons [data-action="copy"]').onclick = () => {
    copy(url).then(ok => {
      if (ok) {
        notify(`<div class="SimpleVideoApp--notify SimpleVideoApp--toast-copy">
          <div>Link copiado</div>
          <div class="SimpleVideoApp--url user-select-all text-truncate">${url}</div>
        </div>`, '.SimpleVideoApp--toast-copy')
      } else {
        notify(`<div class="SimpleVideoApp--notify SimpleVideoApp--toast-copy">
          <div>No se pudo copiar el link. Seleccionelo manualmente y copielo</div>
          <div class="SimpleVideoApp--url user-select-all text-truncate">${url}</div>
        </div>`, '.SimpleVideoApp--toast-copy', 30000)
      }
    })
  }

  signalingSocket.on('connect', async () => {
    console.log('Connected to signaling server')
    try {
      await setup()
    } catch (e) {
      console.log(e)
    }
    signalingSocket.emit('join', { channel, userdata: {} })
  })

  signalingSocket.on('disconnect', () => {
    for (peer_id in peerMediaElements) {
      peerMediaElements[peer_id].remove()
    }
    for (peer_id in peers) {
      peers[peer_id].close()
    }

    peers = {}
    peerMediaElements = {}
  })

  signalingSocket.on('addPeer', config => {
    const { peer_id } = config
    if (peer_id in peers) return
    peerConnection = new RTCPeerConnection(
      { iceServers },
      {
        optional: [
          { DtlsSrtpKeyAgreement: true },
          { OfferToReceiveAudio: true },
          { OfferToReceiveVideo: true }
        ]
      }
    )
    peers[peer_id] = peerConnection

    peerConnection.onicecandidate = event => {
      if (!event.candidate) return
      const { candidate, sdpMLineIndex } = event.candidate
      signalingSocket.emit('relayICECandidate', {
        peer_id,
        ice_candidate: { sdpMLineIndex, candidate }
      })
    }

    peerConnection.onaddstream = event => {
      const $wrapper = document.createElement('div')
      $wrapper.setAttribute('class', 'SimpleVideoApp--video-wrapper')
      const $video = document.createElement('video')
      $wrapper.appendChild($video)
      $video.setAttribute('class', `SimpleVideoApp--video-mirror SimpleVideoApp--video`)
      $video.setAttribute('playsinline', true)
      $video.autoplay = true
      $video.controls = false
      $video.mediaGroup = 'remotevideo'
      peerMediaElements[peer_id] = $video
      document.querySelector('.SimpleVideoApp--videos').appendChild($wrapper)
      document.querySelector('.SimpleVideoApp--message').style.display = 'none'

      $video.srcObject = event.stream
    }

    /* Add our local stream */
    peerConnection.addStream(localMediaStream)

    if (config.should_create_offer) {
      peerConnection.createOffer(
        local_description => {
          peerConnection.setLocalDescription(
            local_description,
            () => {
              signalingSocket.emit('relaySessionDescription', {
                peer_id: peer_id,
                session_description: local_description
              })
            },
            err => {
              console.log(err)
              alert('Offer setLocalDescription failed!')
            }
          )
        },
        error => {
          console.log('Error sending offer: ', error)
        }
      )
    }
  })

  signalingSocket.on('sessionDescription', config => {
    const { peer_id, session_description } = config
    const peer = peers[peer_id]

    const description = new RTCSessionDescription(session_description)
    const stuff = peer.setRemoteDescription(
      description,
      () => {
        if (session_description.type === 'offer') {
          peer.createAnswer(
            local_description => {
              peer.setLocalDescription(
                local_description,
                () => {
                  signalingSocket.emit('relaySessionDescription', {
                    peer_id: peer_id,
                    session_description: local_description
                  })
                },
                err => {
                  console.log(err)
                  alert('Answer setLocalDescription failed!')
                }
              )
            },
            error => {
              console.log('Error creating answer: ', error)
            }
          )
        }
      },
      error => {
        console.log('setRemoteDescription error: ', error)
      }
    )
  })

  signalingSocket.on('iceCandidate', config => {
    peers[config.peer_id].addIceCandidate(new RTCIceCandidate(config.ice_candidate))
  })

  signalingSocket.on('removePeer', config => {
    const { peer_id } = config
    if (peer_id in peerMediaElements) {
      peerMediaElements[peer_id].parentNode.remove()
    }
    if (peer_id in peers) {
      peers[peer_id].close()
    }

    delete peers[peer_id]
    delete peerMediaElements[config.peer_id]
  })
}

const setup = async () => {
  if (localMediaStream) return

  localMediaStream = await navigator.mediaDevices.getUserMedia({ audio: USE_AUDIO, video: USE_VIDEO }).catch(() => {
    alert('This app will not work without camera/microphone access.')
  })

  if (!localMediaStream) return

  document.querySelector('.SimpleVideoApp--message').style.display = 'none'

  document.querySelector('.SimpleVideoApp--muteAudio').addEventListener('click', e => {
  	localMediaStream.getAudioTracks()[0].enabled = !localMediaStream.getAudioTracks()[0].enabled
    e.target.classList.toggle('fa-microphone')
    e.target.classList.toggle('fa-microphone-slash')
  })

  document.querySelector('.SimpleVideoApp--muteVideo').addEventListener('click', e => {
    localMediaStream.getVideoTracks()[0].enabled = !localMediaStream.getVideoTracks()[0].enabled
    e.target.classList.toggle('fa-video')
    e.target.classList.toggle('fa-video-slash')
  })

  navigator.mediaDevices.enumerateDevices().then(devices => {
    const videoInput = devices.filter(device => device.kind === 'videoinput')
    if (videoInput.length > 1) {
      document.querySelector('.SimpleVideoApp--swapCamera').addEventListener('click', e =>
        swapCamera()
      )
    } else {
      document.querySelector('.SimpleVideoApp--swapCamera').style.display = 'none'
    }
  })

  if (navigator.getDisplayMedia || navigator.mediaDevices.getDisplayMedia) {
    document.querySelector('.SimpleVideoApp--screenShare').addEventListener('click', e =>
      toggleScreenSharing()
    )
  } else {
    document.querySelector('.SimpleVideoApp--screenShare').style.display = 'none'
  }

  document.querySelector('.SimpleVideoApp--buttons').style.opacity = '1'
  document.querySelector('.SimpleVideoApp--message').style.opacity = '1'

  const $wrapper = document.createElement('div')
  $wrapper.setAttribute('class', 'SimpleVideoApp--video-wrapper SimpleVideoApp--video-wrapper-me')
  const $video = document.createElement('video')
  $wrapper.appendChild($video)
  $video.setAttribute('class', `SimpleVideoApp--mirror SimpleVideoApp--video SimpleVideoApp--video-me`)
  $video.setAttribute('playsinline', true)
  $video.autoplay = true
  $video.controls = false
  $video.muted = true
  $video.volume = 0
  document.querySelector('.SimpleVideoApp--videos').appendChild($wrapper)
  document.querySelector('.SimpleVideoApp--buttons').style.display = 'flex'
  $video.srcObject = localMediaStream
}

const toggleScreenSharing = () => {
  const screenShareBtn = document.querySelector('.SimpleVideoApp--screenShare')
  const videoMuteBtn = document.querySelector('.SimpleVideoApp--muteVideo')
  let screenMediaPromise
  if (!IS_SCREEN_STREAMING) {
    if (navigator.getDisplayMedia) {
      screenMediaPromise = navigator.getDisplayMedia({ video: true })
    } else if (navigator.mediaDevices.getDisplayMedia) {
      screenMediaPromise = navigator.mediaDevices.getDisplayMedia({ video: true })
    } else {
      screenMediaPromise = navigator.mediaDevices.getUserMedia({
        video: { mediaSource: 'screen' }
      })
    }
  } else {
    screenMediaPromise = navigator.mediaDevices.getUserMedia({ video: true })
    videoMuteBtn.className = 'SimpleVideoApp--muteVideo fas fa-fw fa-video' // make sure to enable video
  }
  screenMediaPromise
    .then(screenStream => {
      IS_SCREEN_STREAMING = !IS_SCREEN_STREAMING

      var sender = peerConnection
        .getSenders()
        .find(s => (s.track ? s.track.kind === 'video' : false))
      sender.replaceTrack(screenStream.getVideoTracks()[0])
      screenStream.getVideoTracks()[0].enabled = true

      const newStream = new MediaStream([
        screenStream.getVideoTracks()[0],
        localMediaStream.getAudioTracks()[0]
      ])
      localMediaStream = newStream

      document.querySelector('.SimpleVideoApp--video-me').srcObject = newStream
      document.querySelector('.SimpleVideoApp--video-me').classList.toggle('SimpleVideoApp--video-mirror')
      screenShareBtn.classList.toggle('active')

      var videoBtnDState = document.querySelector('.SimpleVideoApp--muteVideo').getAttribute('disabled')
      videoBtnDState = videoBtnDState === null ? false : true
      document.querySelector('.SimpleVideoApp--muteVideo').disabled = !videoBtnDState
      screenStream.getVideoTracks()[0].onended = () => {
        if (IS_SCREEN_STREAMING) toggleScreenSharing()
      }
    })
    .catch(e => {
      alert('Unable to share screen.')
      console.error(e)
    })
}

const swapCamera = () => {
  CAMERA = CAMERA == 'user' ? 'environment' : 'user'
  if (CAMERA == 'user') USE_VIDEO = true
  else USE_VIDEO = { facingMode: { exact: CAMERA } }
  navigator.mediaDevices
    .getUserMedia({ video: USE_VIDEO })
    .then(camStream => {
      if (peerConnection) {
        var sender = peerConnection
          .getSenders()
          .find(s => (s.track ? s.track.kind === 'video' : false))
        sender.replaceTrack(camStream.getVideoTracks()[0])
      }
      camStream.getVideoTracks()[0].enabled = true

      const newStream = new MediaStream([
        camStream.getVideoTracks()[0],
        localMediaStream.getAudioTracks()[0]
      ])
      localMediaStream = newStream
      document.querySelector('.SimpleVideoApp--video-me').srcObject = newStream
      document.querySelector('.SimpleVideoApp--video-me').classList.toggle('SimpleVideoApp--video-mirror')
    })
    .catch(err => {
      console.log(err)
      alert('Error is swaping camera')
    })
}

window.SimpleVideoApp.close = () => {
	try {
		clearTimeout(tickers.resize)
	} catch {}
  try {
		document.querySelector('.SimpleVideoApp--video-me').srcObject.getTracks().forEach(track => track.stop())
	} catch {}
}
