import React, { useState, useEffect, useRef } from 'react';
import { Video, Mic, MicOff, VideoOff, Users, PhoneOff, Phone, PhoneIncoming, Check, X, UserPlus, ChevronDown, ChevronUp } from 'lucide-react';

// ==================== CONFIGURATION ====================
const API_BASE_URL = 'http://localhost:8000/pyapi/ambientlistening/api/v1';
const WS_ENABLED = true;
const WS_BASE_URL = 'ws://localhost:8000/pyapi/ambientlistening/api/v1';

const App = () => {
  // ==================== STATE ====================
  const [view, setView] = useState('login');
  const [userType, setUserType] = useState(null);
  const [username, setUsername] = useState('');
  const [userId, setUserId] = useState(null);
  const [callData, setCallData] = useState(null);
  const [callId, setCallId] = useState(null);
  const [incomingCalls, setIncomingCalls] = useState([]);
  const [onlineUsers, setOnlineUsers] = useState([]);
  const [selectedUsers, setSelectedUsers] = useState([]);
  const [showParticipantsList, setShowParticipantsList] = useState(false);
  const [wsConnected, setWsConnected] = useState(false);
  const [loadingOnlineUsers, setLoadingOnlineUsers] = useState(false);
  
  // Twilio state
  const [room, setRoom] = useState(null);
  const [isAudioEnabled, setIsAudioEnabled] = useState(true);
  const [isVideoEnabled, setIsVideoEnabled] = useState(true);
  const [remoteParticipants, setRemoteParticipants] = useState([]);
  const [isRecording, setIsRecording] = useState(false);
  const [participantsInCall, setParticipantsInCall] = useState([]);
  
  const localVideoRef = useRef(null);
  const remoteVideoRefs = useRef({});
  const wsRef = useRef(null);

  // ==================== LOAD TWILIO SDK ====================
  useEffect(() => {
    const script = document.createElement('script');
    script.src = 'https://sdk.twilio.com/js/video/releases/2.27.0/twilio-video.min.js';
    script.async = true;
    document.body.appendChild(script);
    return () => {
      if (document.body.contains(script)) document.body.removeChild(script);
    };
  }, []);

  // ==================== WEBSOCKET CONNECTION ====================
  useEffect(() => {
    if (!username || !userId || view === 'login' || !WS_ENABLED) {
      return;
    }

    let reconnectTimeout;
    let isConnecting = false;
    let pingInterval;
    let reconnectAttempts = 0;
    const MAX_RECONNECT_ATTEMPTS = 10;
    let isCleanupInProgress = false;

    const connectWs = () => {
      if (isConnecting || wsRef.current?.readyState === WebSocket.OPEN || isCleanupInProgress) {
        return;
      }

      isConnecting = true;
      const wsUrl = `${WS_BASE_URL}/ws/call-notifications/${userId}?adusername=${username}`;
      console.log('🔌 Connecting to WebSocket:', wsUrl);
      
      const ws = new WebSocket(wsUrl);
      
      ws.onopen = () => {
        console.log('✅ Connected to WebSocket:', username);
        isConnecting = false;
        reconnectAttempts = 0;
        setWsConnected(true);
        
        pingInterval = setInterval(() => {
          if (ws.readyState === WebSocket.OPEN) {
            ws.send('ping');
          }
        }, 30000);
      };

      ws.onmessage = (event) => {
        try {
          if (event.data === 'pong') {
            return;
          }
          
          const data = JSON.parse(event.data);
          console.log(`[${username}] WS message:`, data);
          handleWebSocketMessage(data);
        } catch (e) {
          console.error('Error parsing WebSocket message:', e);
        }
      };

      ws.onerror = (error) => {
        console.error('WebSocket error:', error);
        isConnecting = false;
      };
      
      ws.onclose = (event) => {
        console.log('WebSocket disconnected. Code:', event.code, 'Clean:', event.wasClean);
        isConnecting = false;
        setWsConnected(false);
        
        if (pingInterval) {
          clearInterval(pingInterval);
        }
        
        if (reconnectTimeout) {
          clearTimeout(reconnectTimeout);
        }
        
        // Only reconnect if we're still logged in and it wasn't a manual cleanup
        if (username && userId && view !== 'login' && reconnectAttempts < MAX_RECONNECT_ATTEMPTS && !isCleanupInProgress) {
          reconnectAttempts++;
          const delay = Math.min(3000 * reconnectAttempts, 30000);
          console.log(`Will reconnect in ${delay/1000}s... (attempt ${reconnectAttempts}/${MAX_RECONNECT_ATTEMPTS})`);
          reconnectTimeout = setTimeout(connectWs, delay);
        }
      };

      wsRef.current = ws;
    };

    connectWs();
    
    return () => {
      isCleanupInProgress = true;
      if (pingInterval) clearInterval(pingInterval);
      if (reconnectTimeout) clearTimeout(reconnectTimeout);
      if (wsRef.current) {
        // Only close if we're actually leaving (logging out)
        if (view === 'login' || !username) {
          if (wsRef.current.readyState === WebSocket.OPEN) {
            wsRef.current.close();
          }
          wsRef.current = null;
        }
      }
    };
  }, [username, userId, view]);

  // ==================== HANDLE WEBSOCKET MESSAGES ====================
  const handleWebSocketMessage = (data) => {
    console.log('🔔 WebSocket Message Received:', {
      type: data.type,
      callId: data.call_id,
      currentCallId: callId,
      currentView: view,
      username: username
    });
    
    switch (data.type) {
      case 'connection_established':
        console.log('✅ Connection established', data.is_reconnect ? '(reconnect)' : '(new)');
        break;
        
      case 'incoming_call':
        console.log('📞 Incoming call:', data);
        setIncomingCalls(prev => [...prev, {
          call_id: data.call_id,
          caller_name: data.caller_name,
          caller_id: data.caller_id,
          room_name: data.room_name
        }]);
        break;
        
      case 'call_accepted':
        console.log('✅ Call accepted by:', data.accepter_name);
        if (callId) {
          fetchParticipants(callId);
        }
        break;
        
      case 'participant_joined':
        console.log('👤 Participant joined:', data.participant_name);
        if (callId) {
          fetchParticipants(callId);
        }
        break;
        
      case 'participant_left':
        console.log('👋 Participant left:', data.participant_name);
        if (callId) {
          fetchParticipants(callId);
        }
        break;
        
      case 'call_ended':
        console.log('🔵 Call ended notification received:', {
          data_call_id: data.call_id,
          current_call_id: callId,
          match: callId === data.call_id,
          in_room: view === 'room'
        });
        
        if (view === 'room' && callId === data.call_id) {
          console.log('⚠️ SHOWING ALERT - Call ended by host');
          alert('Call has been ended by the host');
          handleCallEnd();
        } else {
          console.log('ℹ️ Ignoring call_ended - not in matching call');
        }
        break;
        
      case 'recording_started':
        setIsRecording(true);
        break;
        
      default:
        console.log('❓ Unknown message type:', data.type);
        break;
    }
  };

  // ==================== PAGE UNLOAD CLEANUP ====================
  useEffect(() => {
    const handleBeforeUnload = () => {
      if (wsRef.current) wsRef.current.close();
      if (room) room.disconnect();
      
      if (callId && userType === 'provider') {
        navigator.sendBeacon(
          `${API_BASE_URL}/calls/${callId}/end-by-username`,
          new Blob([JSON.stringify({ admin_adusername: username })], { type: 'application/json' })
        );
      }
    };

    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, [room, callId, userType, username]);

  // ==================== API HELPER ====================
  const apiCall = async (endpoint, method = 'GET', body = null) => {
    const fullUrl = `${API_BASE_URL}${endpoint}`;
    
    try {
      const options = {
        method,
        headers: { 'Content-Type': 'application/json' },
      };
      
      if (body) options.body = JSON.stringify(body);
      
      const response = await fetch(fullUrl, options);
      const data = await response.json();
      
      if (!response.ok) {
        throw new Error(data.detail || data.message || 'API call failed');
      }
      
      return data;
    } catch (error) {
      console.error('API Error:', error);
      throw error;
    }
  };

  // ==================== FETCH ONLINE USERS ====================
  const fetchOnlineUsers = async () => {
    try {
      setLoadingOnlineUsers(true);
      const response = await apiCall('/ws/online-users');
      const users = response.data?.users || [];
      
      const otherUsers = users.filter(u => u.adusername !== username);
      setOnlineUsers(otherUsers);
      
      console.log('👥 Online users:', otherUsers.length);
    } catch (error) {
      console.error('Error fetching online users:', error);
    } finally {
      setLoadingOnlineUsers(false);
    }
  };

  // Poll for online users on provider dashboard
  useEffect(() => {
    if (view === 'dashboard' && userType === 'provider') {
      fetchOnlineUsers();
      const interval = setInterval(fetchOnlineUsers, 5000);
      return () => clearInterval(interval);
    }
  }, [view, userType, username]);

  // ==================== LOGIN ====================
  const loginUser = async (adusername, role) => {
    try {
      const response = await apiCall(`/calls/users/by-username/${adusername}`);
      const userData = response.data;
      
      setUserId(userData.user_id);
      setUsername(adusername);
      setUserType(role);
      setView('dashboard');
    } catch (error) {
      console.error('Login error:', error);
      alert(`Login failed: ${error.message}`);
    }
  };

  // ==================== START CALL ====================
  const startCallWithUsers = async (selectedUsers) => {
    if (!window.Twilio?.Video) {
      alert('Twilio SDK not loaded yet.');
      return;
    }
    
    try {
      const response = await apiCall('/calls/start-by-username', 'POST', {
        caller_adusername: username,
        participant_adusernames: selectedUsers,
        call_type: 'video',
        conversation_friendly_name: 'Video Consultation'
      });

      const data = response.data;
      const accessToken = data.access_token || data.caller_token;
      const roomName = data.room_name || data.twilio_room_name;
      
      setCallData(data);
      setCallId(data.call_id);
      setParticipantsInCall([username]);
      
      if (accessToken && roomName) {
        setView('room');
        setIsRecording(true);
        
        setTimeout(() => {
          joinRoom(accessToken, roomName);
        }, 300);
      } else {
        throw new Error('Missing access token or room name');
      }
    } catch (error) {
      alert(`Failed to start call: ${error.message}`);
    }
  };

  // ==================== ACCEPT CALL ====================
  const acceptCall = async (call) => {
    if (!window.Twilio?.Video) {
      alert('Twilio SDK not loaded yet.');
      return;
    }
    
    try {
      const response = await apiCall(`/calls/${call.call_id}/accept-by-username`, 'POST', {
        adusername: username
      });

      const data = response.data;
      const accessToken = data.access_token || data.token;
      const roomName = data.room_name || data.twilio_room_name || call.room_name;
      
      setCallData(data);
      setCallId(call.call_id);
      setIncomingCalls(prev => prev.filter(c => c.call_id !== call.call_id));
      
      if (accessToken && roomName) {
        setView('room');
        
        setTimeout(() => {
          joinRoom(accessToken, roomName);
        }, 300);
      } else {
        throw new Error('Missing credentials');
      }
    } catch (error) {
      alert(`Failed to accept call: ${error.message}`);
    }
  };

  // ==================== DECLINE CALL ====================
  const declineCall = async (call) => {
    try {
      await apiCall(`/calls/${call.call_id}/decline-by-username`, 'POST', {
        adusername: username
      });
      
      setIncomingCalls(prev => prev.filter(c => c.call_id !== call.call_id));
    } catch (error) {
      console.error('Error declining call:', error);
    }
  };

  // ==================== ADD PARTICIPANT ====================
  const addParticipantToCall = async (participantUsername) => {
    try {
      await apiCall(`/calls/${callId}/add-participant-by-username`, 'POST', {
        caller_adusername: username,
        new_participant_adusername: participantUsername
      });
      
      alert(`${participantUsername} has been invited`);
    } catch (error) {
      alert(`Failed to add participant: ${error.message}`);
    }
  };

  // ==================== FETCH PARTICIPANTS ====================
  const fetchParticipants = async (currentCallId) => {
    if (!currentCallId) return;
    
    try {
      const response = await apiCall(`/calls/${currentCallId}/participants`);
      const participants = response.data?.participants || [];
      
      setParticipantsInCall(participants.map(p => p.display_name));
    } catch (error) {
      console.error('Error fetching participants:', error);
    }
  };

  // ==================== JOIN TWILIO ROOM ====================
  const joinRoom = async (token, roomName) => {
    if (!window.Twilio?.Video) {
      alert('Twilio SDK not loaded yet.');
      return;
    }

    const Video = window.Twilio.Video;
    let localTracks = [];

    try {
      try {
        localTracks = await Video.createLocalTracks({
          audio: true,
          video: { width: 640, height: 480 }
        });
      } catch (videoError) {
        if (window.confirm('Camera denied. Join with audio only?')) {
          localTracks = await Video.createLocalTracks({ audio: true, video: false });
        } else {
          return;
        }
      }

      if (localVideoRef.current) {
        localVideoRef.current.innerHTML = '';
        const videoTrack = localTracks.find(track => track.kind === 'video');
        
        if (videoTrack) {
          const videoElement = videoTrack.attach();
          videoElement.style.width = '100%';
          videoElement.style.height = '100%';
          videoElement.style.objectFit = 'cover';
          videoElement.autoplay = true;
          videoElement.playsInline = true;
          videoElement.muted = true;
          
          localVideoRef.current.appendChild(videoElement);
        }
      }

      const connectedRoom = await Video.connect(token, {
        name: roomName,
        tracks: localTracks,
        dominantSpeaker: true,
        networkQuality: { local: 1, remote: 1 }
      });

      setRoom(connectedRoom);

      connectedRoom.on('disconnected', (room, error) => {
        if (error) console.error('Disconnect:', error);
      });

      connectedRoom.participants.forEach(participantConnected);
      connectedRoom.on('participantConnected', participantConnected);
      connectedRoom.on('participantDisconnected', participantDisconnected);
      connectedRoom.on('recordingStarted', () => setIsRecording(true));

    } catch (error) {
      console.error('Error joining room:', error);
      alert(`Failed to join: ${error.message}`);
      localTracks.forEach(track => track.stop());
      handleCallEnd();
    }
  };

  // ==================== HANDLE PARTICIPANTS ====================
  const participantConnected = (participant) => {
    setRemoteParticipants(prev => {
      if (prev.find(p => p.sid === participant.sid)) return prev;
      return [...prev, participant];
    });

    participant.tracks.forEach(publication => {
      if (publication.isSubscribed && publication.track) {
        trackSubscribed(publication.track, participant);
      }
      publication.on('subscribed', track => trackSubscribed(track, participant));
    });

    participant.on('trackSubscribed', track => trackSubscribed(track, participant));
    participant.on('trackUnsubscribed', track => {
      track.detach().forEach(element => element.remove());
    });
  };

  const trackSubscribed = (track, participant) => {
    if (track.kind === 'video') {
      const container = remoteVideoRefs.current[participant.sid];
      const attachVideo = (cont) => {
        if (cont) {
          cont.innerHTML = '';
          const videoElement = track.attach();
          videoElement.style.width = '100%';
          videoElement.style.height = '100%';
          videoElement.style.objectFit = 'cover';
          videoElement.autoplay = true;
          videoElement.playsInline = true;
          cont.appendChild(videoElement);
        }
      };

      if (container) {
        attachVideo(container);
      } else {
        setTimeout(() => attachVideo(remoteVideoRefs.current[participant.sid]), 500);
      }
    } else if (track.kind === 'audio') {
      const audioElement = track.attach();
      audioElement.autoplay = true;
      document.body.appendChild(audioElement);
    }
  };

  const participantDisconnected = (participant) => {
    setRemoteParticipants(prev => prev.filter(p => p.sid !== participant.sid));
  };

  // ==================== TOGGLE CONTROLS ====================
  const toggleAudio = () => {
    if (!room) return;
    room.localParticipant.audioTracks.forEach(publication => {
      publication.track.isEnabled ? publication.track.disable() : publication.track.enable();
    });
    setIsAudioEnabled(!isAudioEnabled);
  };

  const toggleVideo = () => {
    if (!room) return;
    room.localParticipant.videoTracks.forEach(publication => {
      publication.track.isEnabled ? publication.track.disable() : publication.track.enable();
    });
    setIsVideoEnabled(!isVideoEnabled);
  };

  // ==================== END CALL ====================
  const endCall = async () => {
    try {
      if (room) {
        room.localParticipant.tracks.forEach(publication => {
          if (publication.track) {
            publication.track.stop();
            publication.unpublish();
          }
        });
        room.disconnect();
      }

      if (callId && userType === 'provider') {
        await apiCall(`/calls/${callId}/end-by-username`, 'POST', {
          admin_adusername: username
        });
      } else if (callId) {
        await apiCall(`/calls/${callId}/leave-by-username`, 'POST', {
          adusername: username
        });
      }

      handleCallEnd();
    } catch (error) {
      console.error('Error ending call:', error);
    }
  };

  const handleCallEnd = () => {
    setView('dashboard');
    setRoom(null);
    setCallData(null);
    setCallId(null);
    setRemoteParticipants([]);
    setIsRecording(false);
    setParticipantsInCall([]);
  };

  // ==================== LOGIN VIEW ====================
  if (view === 'login') {
    return (
      <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 flex items-center justify-center p-4">
        <div className="bg-white rounded-2xl shadow-2xl p-8 max-w-md w-full">
          <div className="text-center mb-8">
            <div className="bg-blue-600 w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-4">
              <Video className="text-white" size={32} />
            </div>
            <h1 className="text-3xl font-bold text-gray-800 mb-2">Video Call System</h1>
            <p className="text-gray-600">Choose your role</p>
          </div>

          <div className="space-y-4 mb-6">
            <button
              onClick={() => setUserType('provider')}
              className={`w-full p-4 rounded-xl border-2 transition-all ${
                userType === 'provider' 
                  ? 'border-blue-600 bg-blue-50' 
                  : 'border-gray-200 hover:border-blue-300'
              }`}
            >
              <div className="text-left">
                <h3 className="font-semibold text-gray-800">Provider/Caller</h3>
                <p className="text-sm text-gray-600">Start and manage calls</p>
              </div>
            </button>

            <button
              onClick={() => setUserType('participant')}
              className={`w-full p-4 rounded-xl border-2 transition-all ${
                userType === 'participant' 
                  ? 'border-green-600 bg-green-50' 
                  : 'border-gray-200 hover:border-green-300'
              }`}
            >
              <div className="text-left">
                <h3 className="font-semibold text-gray-800">Participant</h3>
                <p className="text-sm text-gray-600">Join when invited</p>
              </div>
            </button>
          </div>

          <input
            type="text"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            onKeyPress={(e) => e.key === 'Enter' && username && userType && loginUser(username, userType)}
            className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 mb-4"
            placeholder="Enter username (e.g., ANETHRA)"
          />

          <button
            onClick={() => username && userType && loginUser(username, userType)}
            disabled={!username || !userType}
            className="w-full bg-blue-600 hover:bg-blue-700 disabled:bg-gray-300 text-white font-semibold py-3 rounded-xl transition-colors"
          >
            Continue
          </button>
        </div>
      </div>
    );
  }

  // ==================== PROVIDER DASHBOARD ====================
  if (view === 'dashboard' && userType === 'provider') {
    return (
      <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 p-4">
        <div className="max-w-4xl mx-auto">
          <div className="bg-white rounded-2xl shadow-2xl p-8">
            <div className="flex justify-between items-center mb-8">
              <div>
                <h2 className="text-2xl font-bold text-gray-800">Provider Dashboard</h2>
                <div className="flex items-center gap-3 mt-1">
                  <p className="text-gray-600">{username}</p>
                  <div className="flex items-center gap-2">
                    <div className={`w-2 h-2 rounded-full ${wsConnected ? 'bg-green-500' : 'bg-red-500'}`}></div>
                    <span className="text-xs text-gray-500">{wsConnected ? 'Connected' : 'Disconnected'}</span>
                  </div>
                </div>
              </div>
              <button
                onClick={() => {
                  setUsername('');
                  setUserId(null);
                  setUserType(null);
                  setView('login');
                }}
                className="text-sm text-gray-600 hover:text-gray-800"
              >
                Logout
              </button>
            </div>

            <div className="mb-6 p-4 bg-blue-50 border border-blue-200 rounded-lg">
              <div className="flex justify-between items-center mb-3">
                <h3 className="text-lg font-semibold text-gray-800">
                  Select Users to Call
                </h3>
                <button
                  onClick={fetchOnlineUsers}
                  disabled={loadingOnlineUsers}
                  className="text-sm text-blue-600 hover:text-blue-700 flex items-center gap-1 disabled:opacity-50"
                >
                  🔄 Refresh
                </button>
              </div>
              
              {loadingOnlineUsers ? (
                <div className="text-center py-4">
                  <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600 mx-auto"></div>
                </div>
              ) : onlineUsers.length > 0 ? (
                <div className="space-y-2 mb-4">
                  <p className="text-sm text-gray-600 mb-2">
                    ✅ {onlineUsers.length} online • {selectedUsers.length} selected
                  </p>
                  {onlineUsers.map(user => (
                    <div 
                      key={user.user_id} 
                      className={`flex items-center justify-between p-3 rounded-lg border transition-all cursor-pointer ${
                        selectedUsers.includes(user.adusername)
                          ? 'bg-blue-50 border-blue-300'
                          : 'bg-white border-gray-200 hover:border-blue-300'
                      }`}
                      onClick={() => {
                        if (selectedUsers.includes(user.adusername)) {
                          setSelectedUsers(prev => prev.filter(u => u !== user.adusername));
                        } else {
                          setSelectedUsers(prev => [...prev, user.adusername]);
                        }
                      }}
                    >
                      <div className="flex items-center gap-3">
                        <div className="w-2 h-2 bg-green-500 rounded-full animate-pulse"></div>
                        <span className="font-medium text-gray-800">{user.adusername}</span>
                      </div>
                      <input
                        type="checkbox"
                        checked={selectedUsers.includes(user.adusername)}
                        readOnly
                        className="w-5 h-5 text-blue-600 rounded pointer-events-none"
                      />
                    </div>
                  ))}
                </div>
              ) : (
                <div className="text-center py-6 bg-white rounded-lg border border-gray-200 mb-4">
                  <Users className="text-gray-400 mx-auto mb-2" size={40} />
                  <p className="text-gray-600 font-medium">No users online</p>
                </div>
              )}
              
              <div className="pt-4 border-t border-gray-300">
                <p className="text-sm text-gray-600 mb-2">Or add manually:</p>
                <input
                  type="text"
                  placeholder="Enter username (e.g., SJEEV)"
                  onKeyPress={(e) => {
                    if (e.key === 'Enter' && e.target.value.trim()) {
                      const newUser = e.target.value.trim();
                      if (!selectedUsers.includes(newUser)) {
                        setSelectedUsers(prev => [...prev, newUser]);
                      }
                      e.target.value = '';
                    }
                  }}
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                />
              </div>

              {selectedUsers.length > 0 && (
                <div className="mt-4 pt-4 border-t border-gray-300">
                  <p className="text-sm font-medium text-gray-700 mb-2">Selected ({selectedUsers.length}):</p>
                  <div className="space-y-2">
                    {selectedUsers.map(user => (
                      <div key={user} className="flex items-center justify-between bg-blue-50 p-2 rounded-lg">
                        <span className="text-sm font-medium text-gray-800">{user}</span>
                        <button
                          onClick={() => setSelectedUsers(prev => prev.filter(u => u !== user))}
                          className="text-red-600 hover:text-red-700"
                        >
                          <X size={16} />
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>

            <button
              onClick={() => startCallWithUsers(selectedUsers)}
              disabled={selectedUsers.length === 0}
              className="w-full bg-blue-600 hover:bg-blue-700 disabled:bg-gray-300 text-white font-semibold py-4 rounded-xl transition-colors flex items-center justify-center gap-2"
            >
              <Phone size={20} />
              Start Call with {selectedUsers.length} User{selectedUsers.length !== 1 ? 's' : ''}
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ==================== PARTICIPANT DASHBOARD ====================
  if (view === 'dashboard' && userType === 'participant') {
    return (
      <div className="min-h-screen bg-gradient-to-br from-green-50 to-teal-100 p-4">
        <div className="max-w-4xl mx-auto">
          <div className="bg-white rounded-2xl shadow-2xl p-8">
            <div className="flex justify-between items-center mb-8">
              <div>
                <h2 className="text-2xl font-bold text-gray-800">Participant Dashboard</h2>
                <div className="flex items-center gap-3 mt-1">
                  <p className="text-gray-600">{username}</p>
                  <div className="flex items-center gap-2">
                    <div className={`w-2 h-2 rounded-full ${wsConnected ? 'bg-green-500' : 'bg-red-500'}`}></div>
                    <span className="text-xs text-gray-500">{wsConnected ? 'Connected' : 'Disconnected'}</span>
                  </div>
                </div>
              </div>
              <button
                onClick={() => {
                  setUsername('');
                  setUserId(null);
                  setUserType(null);
                  setView('login');
                }}
                className="text-sm text-gray-600 hover:text-gray-800"
              >
                Logout
              </button>
            </div>

            {incomingCalls.length > 0 ? (
              <div>
                <h3 className="text-lg font-semibold text-gray-800 mb-4">📞 Incoming Calls</h3>
                <div className="space-y-3">
                  {incomingCalls.map((call) => (
                    <div key={call.call_id} className="bg-green-50 border-2 border-green-200 rounded-lg p-4">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-3">
                          <PhoneIncoming className="text-green-600" size={32} />
                          <div>
                            <p className="font-semibold text-gray-800 text-lg">{call.caller_name} is calling</p>
                            <p className="text-sm text-gray-600">Video call</p>
                          </div>
                        </div>
                        <div className="flex gap-2">
                          <button
                            onClick={() => acceptCall(call)}
                            className="bg-green-600 hover:bg-green-700 text-white px-6 py-3 rounded-lg flex items-center gap-2"
                          >
                            <Check size={20} />
                            Accept
                          </button>
                          <button
                            onClick={() => declineCall(call)}
                            className="bg-red-600 hover:bg-red-700 text-white px-6 py-3 rounded-lg flex items-center gap-2"
                          >
                            <X size={20} />
                            Decline
                          </button>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ) : (
              <div className="bg-gray-50 rounded-lg p-8 text-center">
                <PhoneIncoming className="text-gray-400 mx-auto mb-4" size={48} />
                <h3 className="text-lg font-semibold text-gray-800 mb-2">Waiting for calls...</h3>
                <p className="text-gray-600">You'll receive a notification when someone calls you</p>
              </div>
            )}
          </div>
        </div>
      </div>
    );
  }

  // ==================== VIDEO ROOM VIEW ====================
  if (view === 'room') {
    return (
      <div className="min-h-screen bg-gray-900 flex flex-col">
        <div className="bg-gray-800 border-b border-gray-700 px-6 py-4">
          <div className="flex justify-between items-center">
            <div>
              <h2 className="text-white text-xl font-semibold">{username}</h2>
              <p className="text-gray-400 text-sm">Call ID: {callId?.substring(0, 8)}...</p>
            </div>
            <div className="flex items-center gap-2">
              {isRecording && (
                <div className="flex items-center gap-2 bg-red-600 px-3 py-1 rounded-full">
                  <div className="w-2 h-2 bg-white rounded-full animate-pulse"></div>
                  <span className="text-white text-sm font-medium">Recording</span>
                </div>
              )}
              
              <button
                onClick={() => setShowParticipantsList(!showParticipantsList)}
                className="flex items-center gap-2 bg-gray-700 hover:bg-gray-600 px-3 py-1 rounded-full transition-colors"
              >
                <Users className="text-white" size={16} />
                <span className="text-white text-sm">{remoteParticipants.length + 1}</span>
                {showParticipantsList ? <ChevronUp size={16} className="text-white" /> : <ChevronDown size={16} className="text-white" />}
              </button>
              
              {userType === 'provider' && (
                <button
                  onClick={() => {
                    const name = prompt('Enter participant username to add:');
                    if (name) addParticipantToCall(name);
                  }}
                  className="bg-blue-600 hover:bg-blue-700 text-white px-3 py-1 rounded-full flex items-center gap-2"
                >
                  <UserPlus size={16} />
                  <span className="text-sm">Add</span>
                </button>
              )}
            </div>
          </div>
          
          {showParticipantsList && (
            <div className="mt-4 bg-gray-700 rounded-lg p-4">
              <h3 className="text-white font-semibold mb-2">Participants</h3>
              <div className="space-y-1">
                <div className="text-green-400 text-sm">✓ {username} (You)</div>
                {remoteParticipants.map(p => (
                  <div key={p.sid} className="text-green-400 text-sm">✓ {p.identity}</div>
                ))}
              </div>
            </div>
          )}
        </div>

        <div className="flex-1 p-4 overflow-auto">
          <div className="grid grid-cols-2 gap-4 max-w-6xl mx-auto">
            <div className="relative bg-gray-800 rounded-xl overflow-hidden aspect-video">
              <div ref={localVideoRef} className="w-full h-full"></div>
              <div className="absolute bottom-4 left-4 bg-black bg-opacity-50 px-3 py-1 rounded-full">
                <span className="text-white text-sm font-medium">You ({username})</span>
              </div>
            </div>

            {remoteParticipants.map((participant) => (
              <div key={participant.sid} className="relative bg-gray-800 rounded-xl overflow-hidden aspect-video">
                <div 
                  ref={el => remoteVideoRefs.current[participant.sid] = el}
                  className="w-full h-full"
                ></div>
                <div className="absolute bottom-4 left-4 bg-black bg-opacity-50 px-3 py-1 rounded-full">
                  <span className="text-white text-sm font-medium">{participant.identity}</span>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="bg-gray-800 border-t border-gray-700 px-6 py-4">
          <div className="flex justify-center items-center gap-4">
            <button
              onClick={toggleAudio}
              className={`p-4 rounded-full transition-colors ${
                isAudioEnabled ? 'bg-gray-700 hover:bg-gray-600' : 'bg-red-600 hover:bg-red-700'
              }`}
            >
              {isAudioEnabled ? <Mic className="text-white" size={24} /> : <MicOff className="text-white" size={24} />}
            </button>

            <button
              onClick={toggleVideo}
              className={`p-4 rounded-full transition-colors ${
                isVideoEnabled ? 'bg-gray-700 hover:bg-gray-600' : 'bg-red-600 hover:bg-red-700'
              }`}
            >
              {isVideoEnabled ? <Video className="text-white" size={24} /> : <VideoOff className="text-white" size={24} />}
            </button>

            <button
              onClick={endCall}
              className="p-4 rounded-full bg-red-600 hover:bg-red-700 transition-colors"
            >
              <PhoneOff className="text-white" size={24} />
            </button>
          </div>
        </div>
      </div>
    );
  }

  return null;
};

export default App;