import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  onAuthStateChanged,
  signOut,
} from 'firebase/auth';
import {
  doc,
  setDoc,
  updateDoc,
  collection,
  query,
  where,
  orderBy,
  onSnapshot,
  addDoc,
  serverTimestamp,
} from 'firebase/firestore';
import { auth, db, usernameToEmail } from './firebase.js';
import { Send, LogOut, MessageCircle, UserPlus, LogIn, Circle, Phone, Video, PhoneOff, Mic, MicOff } from 'lucide-react';

const rtcConfig = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
  ],
};

function convoId(a, b) {
  return [a, b].sort().join('__');
}

export default function App() {
  const [screen, setScreen] = useState('login'); // login | signup | app
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const [currentUid, setCurrentUid] = useState(null);
  const [currentUsername, setCurrentUsername] = useState('');
  const [users, setUsers] = useState([]); // [{uid, username}]
  const [activeContact, setActiveContact] = useState(null); // {uid, username}
  const [messages, setMessages] = useState([]);
  const [draft, setDraft] = useState('');
  const [authLoading, setAuthLoading] = useState(true);
  const scrollRef = useRef(null);

  // ---- calling state ----
  const [callStatus, setCallStatus] = useState('idle'); // idle | calling | in-call
  const [incomingCall, setIncomingCall] = useState(null);
  const [currentCallId, setCurrentCallId] = useState(null);
  const [callIsVideo, setCallIsVideo] = useState(false);
  const [micOn, setMicOn] = useState(true);
  const [callPeerName, setCallPeerName] = useState('');
  const pcRef = useRef(null);
  const localStreamRef = useRef(null);
  const remoteStreamRef = useRef(null);
  const localVideoRef = useRef(null);
  const remoteVideoRef = useRef(null);
  const callUnsubsRef = useRef([]);

  // ---- watch auth state ----
  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (user) => {
      if (user) {
        setCurrentUid(user.uid);
        setCurrentUsername(user.email.split('@')[0]);
        setScreen('app');
      } else {
        setCurrentUid(null);
        setScreen('login');
      }
      setAuthLoading(false);
    });
    return () => unsub();
  }, []);

  // ---- live contact list (all signed-up users) ----
  useEffect(() => {
    if (!currentUid) return;
    const unsub = onSnapshot(collection(db, 'users'), (snap) => {
      const list = snap.docs
        .map((d) => ({ uid: d.id, username: d.data().username }))
        .filter((u) => u.uid !== currentUid);
      setUsers(list);
    });
    return () => unsub();
  }, [currentUid]);

  // ---- live messages for active conversation ----
  useEffect(() => {
    if (!activeContact || !currentUid) return;
    const id = convoId(currentUid, activeContact.uid);
    const q = query(
      collection(db, 'conversations', id, 'messages'),
      orderBy('createdAt', 'asc')
    );
    const unsub = onSnapshot(q, (snap) => {
      setMessages(snap.docs.map((d) => d.data()));
    });
    return () => unsub();
  }, [activeContact, currentUid]);

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [messages]);

  // ---- auth actions ----
  const handleSignup = async (e) => {
    e.preventDefault();
    setError('');
    const uname = username.trim();
    if (!uname || !password) {
      setError('Username aur password dono bharein.');
      return;
    }
    if (password.length < 6) {
      setError('Password kam se kam 6 characters ka ho.');
      return;
    }
    setBusy(true);
    try {
      const cred = await createUserWithEmailAndPassword(auth, usernameToEmail(uname), password);
      await setDoc(doc(db, 'users', cred.user.uid), { username: uname });
    } catch (err) {
      if (err.code === 'auth/email-already-in-use') {
        setError('Ye username pehle se liya hua hai.');
      } else {
        setError('Kuch galat ho gaya: ' + err.message);
      }
    }
    setBusy(false);
  };

  const handleLogin = async (e) => {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      await signInWithEmailAndPassword(auth, usernameToEmail(username), password);
    } catch (err) {
      setError('Username ya password galat hai.');
    }
    setBusy(false);
  };

  const handleLogout = async () => {
    await signOut(auth);
    setActiveContact(null);
    setMessages([]);
    setUsername('');
    setPassword('');
  };

  const sendMessage = async () => {
    const text = draft.trim();
    if (!text || !activeContact) return;
    setDraft('');
    const id = convoId(currentUid, activeContact.uid);
    await addDoc(collection(db, 'conversations', id, 'messages'), {
      from: currentUid,
      fromName: currentUsername,
      text,
      createdAt: serverTimestamp(),
    });
  };

  // ---- listen for incoming calls ----
  useEffect(() => {
    if (!currentUid) return;
    const q = query(collection(db, 'calls'), where('to', '==', currentUid), where('status', '==', 'ringing'));
    const unsub = onSnapshot(q, (snap) => {
      if (callStatus !== 'idle') return;
      const docSnap = snap.docs[0];
      setIncomingCall(docSnap ? { id: docSnap.id, ...docSnap.data() } : null);
    });
    return () => unsub();
  }, [currentUid, callStatus]);

  const cleanupCall = useCallback(() => {
    callUnsubsRef.current.forEach((u) => u());
    callUnsubsRef.current = [];
    if (pcRef.current) {
      pcRef.current.close();
      pcRef.current = null;
    }
    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach((t) => t.stop());
      localStreamRef.current = null;
    }
    remoteStreamRef.current = null;
    setCallStatus('idle');
    setCurrentCallId(null);
    setCallIsVideo(false);
    setCallPeerName('');
    setMicOn(true);
  }, []);

  const setupPeerConnection = () => {
    const pc = new RTCPeerConnection(rtcConfig);
    pcRef.current = pc;
    const remoteStream = new MediaStream();
    remoteStreamRef.current = remoteStream;
    if (remoteVideoRef.current) remoteVideoRef.current.srcObject = remoteStream;
    pc.ontrack = (event) => {
      event.streams[0].getTracks().forEach((track) => remoteStream.addTrack(track));
    };
    return pc;
  };

  const startCall = async (withVideo) => {
    if (!activeContact) return;
    try {
      const localStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: withVideo });
      localStreamRef.current = localStream;
      if (localVideoRef.current) localVideoRef.current.srcObject = localStream;

      const pc = setupPeerConnection();
      localStream.getTracks().forEach((track) => pc.addTrack(track, localStream));

      const callDocRef = doc(collection(db, 'calls'));
      const offerCandidates = collection(callDocRef, 'offerCandidates');
      const answerCandidates = collection(callDocRef, 'answerCandidates');

      pc.onicecandidate = (event) => {
        if (event.candidate) addDoc(offerCandidates, event.candidate.toJSON());
      };

      const offerDescription = await pc.createOffer();
      await pc.setLocalDescription(offerDescription);

      await setDoc(callDocRef, {
        from: currentUid,
        fromName: currentUsername,
        to: activeContact.uid,
        toName: activeContact.username,
        video: withVideo,
        status: 'ringing',
        offer: { type: offerDescription.type, sdp: offerDescription.sdp },
      });

      setCurrentCallId(callDocRef.id);
      setCallStatus('calling');
      setCallIsVideo(withVideo);
      setCallPeerName(activeContact.username);

      const unsubCall = onSnapshot(callDocRef, (snap) => {
        const data = snap.data();
        if (!data) return;
        if (data.status === 'ended' || data.status === 'rejected') {
          cleanupCall();
          return;
        }
        if (!pc.currentRemoteDescription && data.answer) {
          pc.setRemoteDescription(new RTCSessionDescription(data.answer));
          setCallStatus('in-call');
        }
      });
      callUnsubsRef.current.push(unsubCall);

      const unsubAnswerCandidates = onSnapshot(answerCandidates, (snap) => {
        snap.docChanges().forEach((change) => {
          if (change.type === 'added') pc.addIceCandidate(new RTCIceCandidate(change.doc.data()));
        });
      });
      callUnsubsRef.current.push(unsubAnswerCandidates);
    } catch (err) {
      alert('Call shuru nahi ho payi: ' + err.message);
      cleanupCall();
    }
  };

  const acceptCall = async () => {
    const callData = incomingCall;
    setIncomingCall(null);
    try {
      const localStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: callData.video });
      localStreamRef.current = localStream;
      if (localVideoRef.current) localVideoRef.current.srcObject = localStream;

      const pc = setupPeerConnection();
      localStream.getTracks().forEach((track) => pc.addTrack(track, localStream));

      const callDocRef = doc(db, 'calls', callData.id);
      const offerCandidates = collection(callDocRef, 'offerCandidates');
      const answerCandidates = collection(callDocRef, 'answerCandidates');

      pc.onicecandidate = (event) => {
        if (event.candidate) addDoc(answerCandidates, event.candidate.toJSON());
      };

      await pc.setRemoteDescription(new RTCSessionDescription(callData.offer));
      const answerDescription = await pc.createAnswer();
      await pc.setLocalDescription(answerDescription);

      await updateDoc(callDocRef, {
        answer: { type: answerDescription.type, sdp: answerDescription.sdp },
        status: 'in-call',
      });

      setCurrentCallId(callDocRef.id);
      setCallStatus('in-call');
      setCallIsVideo(callData.video);
      setCallPeerName(callData.fromName);

      const unsubOfferCandidates = onSnapshot(offerCandidates, (snap) => {
        snap.docChanges().forEach((change) => {
          if (change.type === 'added') pc.addIceCandidate(new RTCIceCandidate(change.doc.data()));
        });
      });
      callUnsubsRef.current.push(unsubOfferCandidates);

      const unsubCallDoc = onSnapshot(callDocRef, (snap) => {
        const data = snap.data();
        if (!data || data.status === 'ended') cleanupCall();
      });
      callUnsubsRef.current.push(unsubCallDoc);
    } catch (err) {
      alert('Call accept nahi ho payi: ' + err.message);
      cleanupCall();
    }
  };

  const rejectCall = async () => {
    if (incomingCall) {
      try {
        await updateDoc(doc(db, 'calls', incomingCall.id), { status: 'rejected' });
      } catch {}
    }
    setIncomingCall(null);
  };

  const hangUp = async () => {
    if (currentCallId) {
      try {
        await updateDoc(doc(db, 'calls', currentCallId), { status: 'ended' });
      } catch {}
    }
    cleanupCall();
  };

  const toggleMic = () => {
    if (localStreamRef.current) {
      localStreamRef.current.getAudioTracks().forEach((t) => (t.enabled = !micOn));
      setMicOn((v) => !v);
    }
  };

  const formatTime = (ts) => {
    if (!ts?.toDate) return '';
    return ts.toDate().toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' });
  };

  // ================= RENDER =================

  if (authLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#0F1B2D]">
        <div className="text-[#8A97AC] italic tracking-wide">connecting…</div>
      </div>
    );
  }

  if (screen === 'login' || screen === 'signup') {
    const isLogin = screen === 'login';
    return (
      <div className="min-h-screen bg-[#0F1B2D] flex items-center justify-center p-6">
        <div className="w-full max-w-sm">
          <div className="flex items-center gap-2 justify-center mb-8">
            <MessageCircle className="text-[#E0A458]" size={28} strokeWidth={1.75} />
            <h1 className="text-3xl text-[#F5F1E8] tracking-tight" style={{ fontFamily: 'Fraunces, Georgia, serif' }}>
              Correspond
            </h1>
          </div>

          <div className="bg-[#16233A] rounded-lg border border-[#2A3B54] p-7 shadow-xl">
            <h2 className="text-[#F5F1E8] text-sm uppercase tracking-[0.15em] mb-6 font-medium">
              {isLogin ? 'Sign in' : 'Create account'}
            </h2>

            <form onSubmit={isLogin ? handleLogin : handleSignup} className="space-y-4">
              <div>
                <label className="block text-[11px] uppercase tracking-wider text-[#8A97AC] mb-1.5">
                  Username
                </label>
                <input
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  className="w-full bg-[#0F1B2D] border border-[#2A3B54] rounded-md px-3 py-2.5 text-[#F5F1E8] outline-none focus:border-[#E0A458] transition-colors"
                  placeholder="e.g. aarav"
                  autoComplete="off"
                />
              </div>
              <div>
                <label className="block text-[11px] uppercase tracking-wider text-[#8A97AC] mb-1.5">
                  Password
                </label>
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="w-full bg-[#0F1B2D] border border-[#2A3B54] rounded-md px-3 py-2.5 text-[#F5F1E8] outline-none focus:border-[#E0A458] transition-colors"
                  placeholder="kam se kam 6 characters"
                />
              </div>

              {error && <p className="text-[#E0785A] text-sm">{error}</p>}

              <button
                type="submit"
                disabled={busy}
                className="w-full bg-[#E0A458] hover:bg-[#eab26a] disabled:opacity-50 text-[#0F1B2D] font-semibold rounded-md py-2.5 flex items-center justify-center gap-2 transition-colors"
              >
                {isLogin ? <LogIn size={17} /> : <UserPlus size={17} />}
                {busy ? 'Ek second…' : isLogin ? 'Sign in' : 'Create account'}
              </button>
            </form>

            <button
              onClick={() => {
                setScreen(isLogin ? 'signup' : 'login');
                setError('');
              }}
              className="w-full text-center text-[#8A97AC] text-sm mt-5 hover:text-[#F5F1E8] transition-colors"
            >
              {isLogin ? 'Naya account banayen' : 'Pehle se account hai? Sign in karein'}
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#0F1B2D] flex">
      <div className="w-full sm:w-80 border-r border-[#2A3B54] flex flex-col">
        <div className="p-5 border-b border-[#2A3B54] flex items-center justify-between">
          <div className="flex items-center gap-2">
            <MessageCircle className="text-[#E0A458]" size={22} strokeWidth={1.75} />
            <span className="text-[#F5F1E8] text-lg" style={{ fontFamily: 'Fraunces, Georgia, serif' }}>
              Correspond
            </span>
          </div>
          <button onClick={handleLogout} title="Logout" className="text-[#8A97AC] hover:text-[#E0785A] transition-colors">
            <LogOut size={19} />
          </button>
        </div>

        <div className="px-5 py-3 text-[#8A97AC] text-xs uppercase tracking-wider">
          Signed in as <span className="text-[#F5F1E8]">{currentUsername}</span>
        </div>

        <div className="flex-1 overflow-y-auto">
          {users.length === 0 && (
            <div className="p-5 text-[#8A97AC] text-sm leading-relaxed">
              Abhi koi aur user nahi hai. Kisi aur ko is website ka link bhejein — sign up karte hi wo yahan aa jayega.
            </div>
          )}
          {users.map((u) => (
            <button
              key={u.uid}
              onClick={() => setActiveContact(u)}
              className={`w-full text-left px-5 py-3.5 flex items-center gap-3 border-b border-[#16233A] transition-colors ${
                activeContact?.uid === u.uid ? 'bg-[#16233A]' : 'hover:bg-[#16233A]/60'
              }`}
            >
              <div className="w-9 h-9 rounded-full bg-[#2A3B54] flex items-center justify-center text-[#F5F1E8] font-medium text-sm shrink-0">
                {u.username.slice(0, 2).toUpperCase()}
              </div>
              <div className="text-[#F5F1E8] text-sm font-medium truncate">{u.username}</div>
            </button>
          ))}
        </div>
      </div>

      <div className="hidden sm:flex flex-1 flex-col">
        {!activeContact ? (
          <div className="flex-1 flex items-center justify-center text-[#8A97AC]">
            <div className="text-center max-w-xs">
              <MessageCircle size={32} className="mx-auto mb-3 text-[#2A3B54]" strokeWidth={1.5} />
              <p className="text-sm">Baat karne ke liye ek contact chunein</p>
            </div>
          </div>
        ) : (
          <>
            <div className="px-6 py-4 border-b border-[#2A3B54] flex items-center gap-3">
              <div className="w-9 h-9 rounded-full bg-[#2A3B54] flex items-center justify-center text-[#F5F1E8] font-medium text-sm">
                {activeContact.username.slice(0, 2).toUpperCase()}
              </div>
              <div className="text-[#F5F1E8] font-medium">{activeContact.username}</div>
              <div className="flex items-center gap-3 ml-auto">
                {callStatus === 'idle' && (
                  <>
                    <button onClick={() => startCall(false)} title="Audio call" className="text-[#8A97AC] hover:text-[#E0A458] transition-colors">
                      <Phone size={18} />
                    </button>
                    <button onClick={() => startCall(true)} title="Video call" className="text-[#8A97AC] hover:text-[#E0A458] transition-colors">
                      <Video size={19} />
                    </button>
                  </>
                )}
                <div className="flex items-center gap-1 text-[#8A97AC] text-xs">
                  <Circle size={7} className="fill-[#E0A458] text-[#E0A458]" />
                  live
                </div>
              </div>
            </div>

            <div ref={scrollRef} className="flex-1 overflow-y-auto px-6 py-5 space-y-3">
              {messages.length === 0 && (
                <p className="text-[#8A97AC] text-sm text-center mt-10">
                  Abhi koi message nahi. Sabse pehla message aap hi bhejein.
                </p>
              )}
              {messages.map((m, i) => {
                const mine = m.from === currentUid;
                return (
                  <div key={i} className={`flex ${mine ? 'justify-end' : 'justify-start'}`}>
                    <div
                      className={`max-w-[70%] rounded-2xl px-4 py-2.5 ${
                        mine ? 'bg-[#E0A458] text-[#0F1B2D] rounded-br-sm' : 'bg-[#2A3B54] text-[#F5F1E8] rounded-bl-sm'
                      }`}
                    >
                      <div className="text-sm leading-relaxed break-words">{m.text}</div>
                      <div className={`text-[10px] mt-1 tracking-wide ${mine ? 'text-[#0F1B2D]/60' : 'text-[#8A97AC]'}`}>
                        {formatTime(m.createdAt)}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>

            <div className="p-4 border-t border-[#2A3B54] flex items-center gap-3">
              <input
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && sendMessage()}
                placeholder="Message likhein…"
                className="flex-1 bg-[#16233A] border border-[#2A3B54] rounded-full px-4 py-2.5 text-[#F5F1E8] outline-none focus:border-[#E0A458] transition-colors text-sm"
              />
              <button
                onClick={sendMessage}
                disabled={!draft.trim()}
                className="bg-[#E0A458] disabled:opacity-40 disabled:cursor-not-allowed hover:bg-[#eab26a] text-[#0F1B2D] rounded-full w-10 h-10 flex items-center justify-center transition-colors shrink-0"
              >
                <Send size={16} />
              </button>
            </div>
          </>
        )}
      </div>

      {activeContact && (
        <div className="sm:hidden fixed inset-0 bg-[#0F1B2D] flex flex-col z-10">
          <div className="px-4 py-4 border-b border-[#2A3B54] flex items-center gap-3">
            <button onClick={() => setActiveContact(null)} className="text-[#8A97AC]">←</button>
            <div className="w-8 h-8 rounded-full bg-[#2A3B54] flex items-center justify-center text-[#F5F1E8] font-medium text-xs">
              {activeContact.username.slice(0, 2).toUpperCase()}
            </div>
            <div className="text-[#F5F1E8] font-medium text-sm">{activeContact.username}</div>
          </div>
          <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-4 space-y-3">
            {messages.map((m, i) => {
              const mine = m.from === currentUid;
              return (
                <div key={i} className={`flex ${mine ? 'justify-end' : 'justify-start'}`}>
                  <div
                    className={`max-w-[75%] rounded-2xl px-3.5 py-2 ${
                      mine ? 'bg-[#E0A458] text-[#0F1B2D] rounded-br-sm' : 'bg-[#2A3B54] text-[#F5F1E8] rounded-bl-sm'
                    }`}
                  >
                    <div className="text-sm break-words">{m.text}</div>
                    <div className={`text-[10px] mt-1 ${mine ? 'text-[#0F1B2D]/60' : 'text-[#8A97AC]'}`}>
                      {formatTime(m.createdAt)}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
          <div className="p-3 border-t border-[#2A3B54] flex items-center gap-2">
            <input
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && sendMessage()}
              placeholder="Message likhein…"
              className="flex-1 bg-[#16233A] border border-[#2A3B54] rounded-full px-4 py-2 text-[#F5F1E8] outline-none text-sm"
            />
            <button
              onClick={sendMessage}
              disabled={!draft.trim()}
              className="bg-[#E0A458] disabled:opacity-40 text-[#0F1B2D] rounded-full w-9 h-9 flex items-center justify-center shrink-0"
            >
              <Send size={15} />
            </button>
          </div>
        </div>
      )}

      {/* Incoming call overlay */}
      {incomingCall && (
        <div className="fixed inset-0 bg-[#0F1B2D]/97 flex flex-col items-center justify-center z-50 p-6">
          <div className="w-20 h-20 rounded-full bg-[#2A3B54] flex items-center justify-center text-[#F5F1E8] text-2xl font-medium mb-5">
            {incomingCall.fromName.slice(0, 2).toUpperCase()}
          </div>
          <div className="text-[#F5F1E8] text-lg font-medium mb-1">{incomingCall.fromName}</div>
          <div className="text-[#8A97AC] text-sm mb-10">
            {incomingCall.video ? 'Video call...' : 'Audio call...'}
          </div>
          <div className="flex items-center gap-8">
            <button
              onClick={rejectCall}
              className="w-14 h-14 rounded-full bg-[#E0785A] flex items-center justify-center text-[#0F1B2D]"
            >
              <PhoneOff size={22} />
            </button>
            <button
              onClick={acceptCall}
              className="w-14 h-14 rounded-full bg-[#7FBF7F] flex items-center justify-center text-[#0F1B2D]"
            >
              <Phone size={22} />
            </button>
          </div>
        </div>
      )}

      {/* Active / outgoing call overlay */}
      {callStatus !== 'idle' && (
        <div className="fixed inset-0 bg-[#0F1B2D] flex flex-col items-center justify-center z-50">
          {callIsVideo ? (
            <div className="relative w-full h-full">
              <video ref={remoteVideoRef} autoPlay playsInline className="w-full h-full object-cover bg-[#16233A]" />
              <video
                ref={localVideoRef}
                autoPlay
                playsInline
                muted
                className="absolute bottom-24 right-4 w-28 h-40 object-cover rounded-lg border border-[#2A3B54]"
              />
              <div className="absolute top-6 left-0 right-0 text-center">
                <div className="text-[#F5F1E8] font-medium">{callPeerName}</div>
                <div className="text-[#8A97AC] text-xs">{callStatus === 'calling' ? 'Calling…' : 'In call'}</div>
              </div>
            </div>
          ) : (
            <>
              <video ref={remoteVideoRef} autoPlay playsInline className="hidden" />
              <video ref={localVideoRef} autoPlay playsInline muted className="hidden" />
              <div className="w-24 h-24 rounded-full bg-[#2A3B54] flex items-center justify-center text-[#F5F1E8] text-3xl font-medium mb-5">
                {callPeerName.slice(0, 2).toUpperCase()}
              </div>
              <div className="text-[#F5F1E8] text-lg font-medium mb-1">{callPeerName}</div>
              <div className="text-[#8A97AC] text-sm mb-10">{callStatus === 'calling' ? 'Calling…' : 'In call'}</div>
            </>
          )}

          <div className="absolute bottom-10 left-0 right-0 flex items-center justify-center gap-6">
            <button
              onClick={toggleMic}
              className="w-12 h-12 rounded-full bg-[#2A3B54] flex items-center justify-center text-[#F5F1E8]"
            >
              {micOn ? <Mic size={19} /> : <MicOff size={19} />}
            </button>
            <button
              onClick={hangUp}
              className="w-14 h-14 rounded-full bg-[#E0785A] flex items-center justify-center text-[#0F1B2D]"
            >
              <PhoneOff size={22} />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
