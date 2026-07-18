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
import { Send, LogOut, MessageCircle, UserPlus, LogIn, Circle, Phone, Video, PhoneOff, Mic, MicOff, Paperclip, Square, X, Reply } from 'lucide-react';

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
  const [hiddenIds, setHiddenIds] = useState(new Set());
  const [selectedMsgId, setSelectedMsgId] = useState(null);
  const [replyTo, setReplyTo] = useState(null); // {id, preview, fromName}
  const [recording, setRecording] = useState(false);
  const scrollRef = useRef(null);
  const fileInputRef = useRef(null);
  const mediaRecorderRef = useRef(null);
  const recordedChunksRef = useRef([]);

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
  const callStartTimeRef = useRef(null);
  const [pipLarge, setPipLarge] = useState(false);
  const pipContainerRef = useRef(null);
  const pipElRef = useRef(null);
  const pipDragState = useRef({ dragging: false, moved: false, startX: 0, startY: 0, baseX: 16, baseY: 16, x: 16, y: 16 });

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

  // ---- load "deleted for me" list from this browser's storage ----
  useEffect(() => {
    if (!currentUid) {
      setHiddenIds(new Set());
      return;
    }
    try {
      const raw = localStorage.getItem(`correspond_hidden_${currentUid}`);
      setHiddenIds(raw ? new Set(JSON.parse(raw)) : new Set());
    } catch {
      setHiddenIds(new Set());
    }
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
      setMessages(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
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
      replyTo: replyTo || null,
      createdAt: serverTimestamp(),
    });
    setReplyTo(null);
  };

  const buildReplyPreview = (m) => {
    if (m.type === 'call') return callLabel(m);
    if (m.type === 'image') return '📷 Photo';
    if (m.type === 'audio') return '🎤 Voice message';
    return (m.text || '').slice(0, 80);
  };

  const startReply = (m) => {
    setReplyTo({
      id: m.id,
      preview: buildReplyPreview(m),
      fromName: m.fromName || (m.from === currentUid ? currentUsername : activeContact?.username),
    });
    setSelectedMsgId(null);
  };

  const compressImage = (file) =>
    new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = (e) => {
        const img = new window.Image();
        img.onload = () => {
          const maxDim = 900;
          let { width, height } = img;
          if (width > maxDim || height > maxDim) {
            if (width > height) {
              height = Math.round(height * (maxDim / width));
              width = maxDim;
            } else {
              width = Math.round(width * (maxDim / height));
              height = maxDim;
            }
          }
          const canvas = document.createElement('canvas');
          canvas.width = width;
          canvas.height = height;
          const ctx = canvas.getContext('2d');
          ctx.drawImage(img, 0, 0, width, height);
          resolve(canvas.toDataURL('image/jpeg', 0.6));
        };
        img.onerror = reject;
        img.src = e.target.result;
      };
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });

  const handleImagePick = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file || !activeContact) return;
    try {
      const dataUrl = await compressImage(file);
      if (dataUrl.length > 900000) {
        alert('Ye photo bahut badi hai. Thodi chhoti ya kam resolution wali photo try karein.');
        return;
      }
      const id = convoId(currentUid, activeContact.uid);
      await addDoc(collection(db, 'conversations', id, 'messages'), {
        from: currentUid,
        fromName: currentUsername,
        type: 'image',
        imageData: dataUrl,
        replyTo: replyTo || null,
        createdAt: serverTimestamp(),
      });
      setReplyTo(null);
    } catch (err) {
      alert('Photo bhejne mein dikkat hui: ' + err.message);
    }
  };

  const startRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const recorder = new MediaRecorder(stream);
      recordedChunksRef.current = [];
      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) recordedChunksRef.current.push(e.data);
      };
      recorder.onstop = () => {
        stream.getTracks().forEach((t) => t.stop());
        const blob = new Blob(recordedChunksRef.current, { type: 'audio/webm' });
        const reader = new FileReader();
        reader.onload = async () => {
          const dataUrl = reader.result;
          if (dataUrl.length > 900000) {
            alert('Ye voice message bahut lamba hai. Thoda chhota (~20-30 second) rakhein.');
            return;
          }
          if (!activeContact) return;
          const id = convoId(currentUid, activeContact.uid);
          await addDoc(collection(db, 'conversations', id, 'messages'), {
            from: currentUid,
            fromName: currentUsername,
            type: 'audio',
            audioData: dataUrl,
            replyTo: replyTo || null,
            createdAt: serverTimestamp(),
          });
          setReplyTo(null);
        };
        reader.readAsDataURL(blob);
      };
      recorder.start();
      mediaRecorderRef.current = recorder;
      setRecording(true);
    } catch (err) {
      alert('Microphone access nahi mila: ' + err.message);
    }
  };

  const stopRecording = () => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      mediaRecorderRef.current.stop();
    }
    setRecording(false);
  };

  const hideForMe = (messageId) => {
    setHiddenIds((prev) => {
      const next = new Set(prev);
      next.add(messageId);
      try {
        localStorage.setItem(`correspond_hidden_${currentUid}`, JSON.stringify([...next]));
      } catch {}
      return next;
    });
    setSelectedMsgId(null);
  };

  const deleteForEveryone = async (messageId) => {
    if (!activeContact) return;
    const id = convoId(currentUid, activeContact.uid);
    try {
      await updateDoc(doc(db, 'conversations', id, 'messages', messageId), {
        deleted: true,
        text: '',
      });
    } catch {}
    setSelectedMsgId(null);
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

  // ---- attach streams to video elements once they mount ----
  useEffect(() => {
    if (callStatus !== 'idle') {
      if (localVideoRef.current) localVideoRef.current.srcObject = localStreamRef.current;
      if (remoteVideoRef.current) remoteVideoRef.current.srcObject = remoteStreamRef.current;
    }
  }, [callStatus, callIsVideo]);

  // ---- position the draggable self-view (PiP) when a video call starts ----
  useEffect(() => {
    if (callStatus !== 'idle' && callIsVideo && pipContainerRef.current && pipElRef.current) {
      const rect = pipContainerRef.current.getBoundingClientRect();
      const w = pipElRef.current.offsetWidth;
      const h = pipElRef.current.offsetHeight;
      const x = rect.width - w - 16;
      const y = rect.height - h - 110;
      pipDragState.current.x = x;
      pipDragState.current.y = y;
      pipElRef.current.style.left = x + 'px';
      pipElRef.current.style.top = y + 'px';
    }
  }, [callStatus, callIsVideo]);

  // ---- re-clamp the PiP within bounds whenever its size toggles ----
  useEffect(() => {
    if (callStatus !== 'idle' && callIsVideo && pipContainerRef.current && pipElRef.current) {
      const rect = pipContainerRef.current.getBoundingClientRect();
      const w = pipElRef.current.offsetWidth;
      const h = pipElRef.current.offsetHeight;
      let { x, y } = pipDragState.current;
      x = Math.min(Math.max(x, 8), Math.max(8, rect.width - w - 8));
      y = Math.min(Math.max(y, 8), Math.max(8, rect.height - h - 8));
      pipDragState.current.x = x;
      pipDragState.current.y = y;
      pipElRef.current.style.left = x + 'px';
      pipElRef.current.style.top = y + 'px';
    }
  }, [pipLarge]);

  const onPipStart = (clientX, clientY) => {
    pipDragState.current.dragging = true;
    pipDragState.current.moved = false;
    pipDragState.current.startX = clientX;
    pipDragState.current.startY = clientY;
    pipDragState.current.baseX = pipDragState.current.x;
    pipDragState.current.baseY = pipDragState.current.y;
  };

  const onPipMove = (clientX, clientY) => {
    if (!pipDragState.current.dragging) return;
    const dx = clientX - pipDragState.current.startX;
    const dy = clientY - pipDragState.current.startY;
    if (Math.abs(dx) > 5 || Math.abs(dy) > 5) pipDragState.current.moved = true;
    let x = pipDragState.current.baseX + dx;
    let y = pipDragState.current.baseY + dy;
    const rect = pipContainerRef.current?.getBoundingClientRect();
    const w = pipElRef.current?.offsetWidth || 0;
    const h = pipElRef.current?.offsetHeight || 0;
    if (rect) {
      x = Math.min(Math.max(x, 8), Math.max(8, rect.width - w - 8));
      y = Math.min(Math.max(y, 8), Math.max(8, rect.height - h - 8));
    }
    pipDragState.current.x = x;
    pipDragState.current.y = y;
    if (pipElRef.current) {
      pipElRef.current.style.left = x + 'px';
      pipElRef.current.style.top = y + 'px';
    }
  };

  const onPipEnd = () => {
    const wasMoved = pipDragState.current.moved;
    pipDragState.current.dragging = false;
    if (!wasMoved) setPipLarge((v) => !v);
  };

  const onPipMouseDown = (e) => {
    onPipStart(e.clientX, e.clientY);
    const move = (ev) => onPipMove(ev.clientX, ev.clientY);
    const up = () => {
      onPipEnd();
      window.removeEventListener('mousemove', move);
      window.removeEventListener('mouseup', up);
    };
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up);
  };

  const onPipTouchStart = (e) => {
    const t = e.touches[0];
    onPipStart(t.clientX, t.clientY);
    const move = (ev) => {
      ev.preventDefault();
      const tt = ev.touches[0];
      onPipMove(tt.clientX, tt.clientY);
    };
    const end = () => {
      onPipEnd();
      window.removeEventListener('touchmove', move);
      window.removeEventListener('touchend', end);
    };
    window.addEventListener('touchmove', move, { passive: false });
    window.addEventListener('touchend', end);
  };

  const writeCallLog = async (data, endReason) => {
    try {
      const id = convoId(data.from, data.to);
      let status, duration = null;
      if (callStartTimeRef.current) {
        status = 'completed';
        duration = Math.round((Date.now() - callStartTimeRef.current) / 1000);
      } else {
        status = endReason === 'rejected' ? 'declined' : 'missed';
      }
      await addDoc(collection(db, 'conversations', id, 'messages'), {
        from: data.from,
        fromName: data.fromName,
        type: 'call',
        video: data.video,
        callStatus: status,
        duration,
        createdAt: serverTimestamp(),
      });
    } catch {}
    callStartTimeRef.current = null;
  };

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
      setPipLarge(false);

      const unsubCall = onSnapshot(callDocRef, (snap) => {
        const data = snap.data();
        if (!data) return;
        if (data.status === 'ended' || data.status === 'rejected') {
          writeCallLog(data, data.status);
          cleanupCall();
          return;
        }
        if (!pc.currentRemoteDescription && data.answer) {
          pc.setRemoteDescription(new RTCSessionDescription(data.answer));
          setCallStatus('in-call');
          callStartTimeRef.current = Date.now();
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
      setPipLarge(false);

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

  const formatDuration = (sec) => {
    if (!sec && sec !== 0) return '';
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    return `${m}:${s.toString().padStart(2, '0')}`;
  };

  const callLabel = (m) => {
    if (m.callStatus === 'completed') return `${m.video ? 'Video' : 'Audio'} call · ${formatDuration(m.duration)}`;
    if (m.callStatus === 'declined') return 'Call declined';
    return 'Missed call';
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
              {messages.filter((m) => !hiddenIds.has(m.id)).map((m) => {
                const mine = m.from === currentUid;
                if (m.type === 'call') {
                  return (
                    <div key={m.id} className="flex justify-center">
                      <div className="flex items-center gap-2 bg-[#16233A] border border-[#2A3B54] rounded-full px-4 py-1.5 text-[#8A97AC] text-xs">
                        {m.video ? <Video size={13} /> : <Phone size={13} />}
                        {callLabel(m)}
                        <span className="opacity-60">· {formatTime(m.createdAt)}</span>
                      </div>
                    </div>
                  );
                }
                return (
                  <div key={m.id} className={`flex flex-col ${mine ? 'items-end' : 'items-start'}`}>
                    <div
                      onClick={() => setSelectedMsgId(selectedMsgId === m.id ? null : m.id)}
                      className={`max-w-[70%] rounded-2xl px-4 py-2.5 cursor-pointer ${
                        mine ? 'bg-[#E0A458] text-[#0F1B2D] rounded-br-sm' : 'bg-[#2A3B54] text-[#F5F1E8] rounded-bl-sm'
                      }`}
                    >
                      {m.replyTo && !m.deleted && (
                        <div className={`mb-1.5 pl-2 border-l-2 text-xs opacity-80 ${mine ? 'border-[#0F1B2D]/50' : 'border-[#E0A458]'}`}>
                          <div className="font-medium">{m.replyTo.fromName}</div>
                          <div className="truncate max-w-[220px]">{m.replyTo.preview}</div>
                        </div>
                      )}
                      {m.deleted ? (
                        <div className="text-sm italic opacity-70">Ye message delete kar diya gaya</div>
                      ) : m.type === 'image' ? (
                        <img src={m.imageData} alt="photo" className="rounded-lg max-w-[220px] max-h-72 object-cover" />
                      ) : m.type === 'audio' ? (
                        <audio controls src={m.audioData} className="max-w-[220px]" />
                      ) : (
                        <div className="text-sm leading-relaxed break-words">{m.text}</div>
                      )}
                      <div className={`text-[10px] mt-1 tracking-wide ${mine ? 'text-[#0F1B2D]/60' : 'text-[#8A97AC]'}`}>
                        {formatTime(m.createdAt)}
                      </div>
                    </div>
                    {selectedMsgId === m.id && (
                      <div className="flex gap-3 mt-1 text-[11px]">
                        <button onClick={() => startReply(m)} className="text-[#E0A458] underline">
                          Reply
                        </button>
                        <button onClick={() => hideForMe(m.id)} className="text-[#8A97AC] underline">
                          Delete for me
                        </button>
                        {mine && !m.deleted && (
                          <button onClick={() => deleteForEveryone(m.id)} className="text-[#E0785A] underline">
                            Delete for everyone
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>

            {replyTo && (
              <div className="px-4 pt-2 pb-1 flex items-center gap-2 border-t border-[#2A3B54] bg-[#16233A]">
                <div className="flex-1 border-l-2 border-[#E0A458] pl-2 py-0.5 min-w-0">
                  <div className="text-[#E0A458] text-xs font-medium">{replyTo.fromName}</div>
                  <div className="text-[#8A97AC] text-xs truncate">{replyTo.preview}</div>
                </div>
                <button onClick={() => setReplyTo(null)} className="text-[#8A97AC] shrink-0">
                  <X size={16} />
                </button>
              </div>
            )}
            <div className={`p-4 flex items-center gap-2 ${replyTo ? '' : 'border-t border-[#2A3B54]'}`}>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                onChange={handleImagePick}
                className="hidden"
              />
              <button
                onClick={() => fileInputRef.current?.click()}
                className="text-[#8A97AC] hover:text-[#E0A458] transition-colors shrink-0"
                title="Photo bhejein"
              >
                <Paperclip size={19} />
              </button>
              <button
                onClick={recording ? stopRecording : startRecording}
                className={`shrink-0 transition-colors ${recording ? 'text-[#E0785A]' : 'text-[#8A97AC] hover:text-[#E0A458]'}`}
                title={recording ? 'Recording rokein aur bhejein' : 'Voice message'}
              >
                {recording ? <Square size={18} /> : <Mic size={19} />}
              </button>
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
            {callStatus === 'idle' && (
              <div className="flex items-center gap-4 ml-auto mr-1">
                <button onClick={() => startCall(false)} className="text-[#8A97AC]">
                  <Phone size={19} />
                </button>
                <button onClick={() => startCall(true)} className="text-[#8A97AC]">
                  <Video size={20} />
                </button>
              </div>
            )}
          </div>
          <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-4 space-y-3">
            {messages.filter((m) => !hiddenIds.has(m.id)).map((m) => {
              const mine = m.from === currentUid;
              if (m.type === 'call') {
                return (
                  <div key={m.id} className="flex justify-center">
                    <div className="flex items-center gap-2 bg-[#16233A] border border-[#2A3B54] rounded-full px-3.5 py-1.5 text-[#8A97AC] text-xs">
                      {m.video ? <Video size={12} /> : <Phone size={12} />}
                      {callLabel(m)}
                      <span className="opacity-60">· {formatTime(m.createdAt)}</span>
                    </div>
                  </div>
                );
              }
              return (
                <div key={m.id} className={`flex flex-col ${mine ? 'items-end' : 'items-start'}`}>
                  <div
                    onClick={() => setSelectedMsgId(selectedMsgId === m.id ? null : m.id)}
                    className={`max-w-[75%] rounded-2xl px-3.5 py-2 ${
                      mine ? 'bg-[#E0A458] text-[#0F1B2D] rounded-br-sm' : 'bg-[#2A3B54] text-[#F5F1E8] rounded-bl-sm'
                    }`}
                  >
                    {m.replyTo && !m.deleted && (
                      <div className={`mb-1.5 pl-2 border-l-2 text-xs opacity-80 ${mine ? 'border-[#0F1B2D]/50' : 'border-[#E0A458]'}`}>
                        <div className="font-medium">{m.replyTo.fromName}</div>
                        <div className="truncate max-w-[200px]">{m.replyTo.preview}</div>
                      </div>
                    )}
                    {m.deleted ? (
                      <div className="text-sm italic opacity-70">Ye message delete kar diya gaya</div>
                    ) : m.type === 'image' ? (
                      <img src={m.imageData} alt="photo" className="rounded-lg max-w-[200px] max-h-64 object-cover" />
                    ) : m.type === 'audio' ? (
                      <audio controls src={m.audioData} className="max-w-[200px]" />
                    ) : (
                      <div className="text-sm break-words">{m.text}</div>
                    )}
                    <div className={`text-[10px] mt-1 ${mine ? 'text-[#0F1B2D]/60' : 'text-[#8A97AC]'}`}>
                      {formatTime(m.createdAt)}
                    </div>
                  </div>
                  {selectedMsgId === m.id && (
                    <div className="flex gap-3 mt-1 text-[11px]">
                      <button onClick={() => startReply(m)} className="text-[#E0A458] underline">
                        Reply
                      </button>
                      <button onClick={() => hideForMe(m.id)} className="text-[#8A97AC] underline">
                        Delete for me
                      </button>
                      {mine && !m.deleted && (
                        <button onClick={() => deleteForEveryone(m.id)} className="text-[#E0785A] underline">
                          Delete for everyone
                        </button>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
          {replyTo && (
            <div className="px-3 pt-2 pb-1 flex items-center gap-2 border-t border-[#2A3B54] bg-[#16233A]">
              <div className="flex-1 border-l-2 border-[#E0A458] pl-2 py-0.5 min-w-0">
                <div className="text-[#E0A458] text-xs font-medium">{replyTo.fromName}</div>
                <div className="text-[#8A97AC] text-xs truncate">{replyTo.preview}</div>
              </div>
              <button onClick={() => setReplyTo(null)} className="text-[#8A97AC] shrink-0">
                <X size={16} />
              </button>
            </div>
          )}
          <div className={`p-3 flex items-center gap-2 ${replyTo ? '' : 'border-t border-[#2A3B54]'}`}>
            <button
              onClick={() => fileInputRef.current?.click()}
              className="text-[#8A97AC] shrink-0"
            >
              <Paperclip size={18} />
            </button>
            <button
              onClick={recording ? stopRecording : startRecording}
              className={`shrink-0 ${recording ? 'text-[#E0785A]' : 'text-[#8A97AC]'}`}
            >
              {recording ? <Square size={17} /> : <Mic size={18} />}
            </button>
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
            <div className="relative w-full h-full" ref={pipContainerRef}>
              <video ref={remoteVideoRef} autoPlay playsInline className="w-full h-full object-cover bg-[#16233A]" />
              <div
                ref={pipElRef}
                onMouseDown={onPipMouseDown}
                onTouchStart={onPipTouchStart}
                style={{ position: 'absolute', left: 0, top: 0, touchAction: 'none' }}
                className={`rounded-lg border border-[#2A3B54] overflow-hidden cursor-grab active:cursor-grabbing select-none ${
                  pipLarge ? 'w-44 h-64' : 'w-28 h-40'
                }`}
              >
                <video ref={localVideoRef} autoPlay playsInline muted className="w-full h-full object-cover pointer-events-none" />
              </div>
              <div className="absolute top-6 left-0 right-0 text-center pointer-events-none">
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
