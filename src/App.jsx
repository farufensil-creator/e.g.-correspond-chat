import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
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
  deleteField,
  increment,
  collection,
  query,
  where,
  orderBy,
  onSnapshot,
  addDoc,
  serverTimestamp,
  writeBatch,
} from 'firebase/firestore';
import { auth, db, usernameToEmail } from './firebase.js';
import {
  Send, LogOut, MessageCircle, UserPlus, LogIn, Phone, Video, PhoneOff, Mic, MicOff,
  Paperclip, Square, X, Users, Check, CheckCheck,
} from 'lucide-react';

const rtcConfig = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
  ],
};

const REACTION_EMOJIS = ['👍', '❤️', '😂', '😮', '😢', '🙏'];

function convoId(a, b) {
  return [a, b].sort().join('__');
}

export default function App() {
  const [screen, setScreen] = useState('login');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const [currentUid, setCurrentUid] = useState(null);
  const [currentUsername, setCurrentUsername] = useState('');
  const [users, setUsers] = useState([]);
  const [convMetas, setConvMetas] = useState({});
  const [groups, setGroups] = useState([]);
  const [activeChat, setActiveChat] = useState(null);
  const [messages, setMessages] = useState([]);
  const [draft, setDraft] = useState('');
  const [authLoading, setAuthLoading] = useState(true);
  const [hiddenIds, setHiddenIds] = useState(new Set());
  const [selectedMsgId, setSelectedMsgId] = useState(null);
  const [replyTo, setReplyTo] = useState(null);
  const [recording, setRecording] = useState(false);
  const [showNewGroup, setShowNewGroup] = useState(false);
  const [newGroupName, setNewGroupName] = useState('');
  const [newGroupMembers, setNewGroupMembers] = useState(new Set());
  const scrollRef = useRef(null);
  const fileInputRef = useRef(null);
  const mediaRecorderRef = useRef(null);
  const recordedChunksRef = useRef([]);
  const typingTimeoutRef = useRef(null);

  const [callStatus, setCallStatus] = useState('idle');
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

  useEffect(() => {
    if (!currentUid) return;
    const setOnline = () => updateDoc(doc(db, 'users', currentUid), { online: true, lastSeen: serverTimestamp() }).catch(() => {});
    const setOffline = () => updateDoc(doc(db, 'users', currentUid), { online: false, lastSeen: serverTimestamp() }).catch(() => {});
    setOnline();
    const heartbeat = setInterval(setOnline, 25000);
    const onVis = () => (document.visibilityState === 'visible' ? setOnline() : setOffline());
    document.addEventListener('visibilitychange', onVis);
    window.addEventListener('beforeunload', setOffline);
    return () => {
      clearInterval(heartbeat);
      document.removeEventListener('visibilitychange', onVis);
      window.removeEventListener('beforeunload', setOffline);
      setOffline();
    };
  }, [currentUid]);

  useEffect(() => {
    if (!currentUid) return;
    const unsub = onSnapshot(collection(db, 'users'), (snap) => {
      const list = snap.docs.map((d) => ({ uid: d.id, ...d.data() })).filter((u) => u.uid !== currentUid);
      setUsers(list);
    });
    return () => unsub();
  }, [currentUid]);

  useEffect(() => {
    if (!currentUid) return;
    const q = query(collection(db, 'conversationMeta'), where('participants', 'array-contains', currentUid));
    const unsub = onSnapshot(q, (snap) => {
      const map = {};
      snap.docs.forEach((d) => (map[d.id] = d.data()));
      setConvMetas(map);
    });
    return () => unsub();
  }, [currentUid]);

  useEffect(() => {
    if (!currentUid) return;
    const q = query(collection(db, 'groups'), where('members', 'array-contains', currentUid));
    const unsub = onSnapshot(q, (snap) => {
      setGroups(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
    });
    return () => unsub();
  }, [currentUid]);

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

  const chatList = useMemo(() => {
    const dmItems = users.map((u) => {
      const id = convoId(currentUid, u.uid);
      const meta = convMetas[id];
      return {
        key: 'dm:' + u.uid,
        type: 'dm',
        uid: u.uid,
        username: u.username,
        online: u.online,
        lastSeen: u.lastSeen,
        lastMessage: meta?.lastMessage || '',
        lastMessageAt: meta?.lastMessageAt || null,
        unread: meta?.unread?.[currentUid] || 0,
        typing: meta?.typingBy === u.uid && meta?.typingAt && Date.now() - meta.typingAt.toMillis() < 4000,
      };
    });
    const groupItems = groups.map((g) => ({
      key: 'group:' + g.id,
      type: 'group',
      id: g.id,
      name: g.name,
      lastMessage: g.lastMessage || '',
      lastMessageAt: g.lastMessageAt || null,
      unread: g.unread?.[currentUid] || 0,
    }));
    const all = [...dmItems, ...groupItems];
    all.sort((a, b) => {
      const at = a.lastMessageAt?.toMillis?.() || 0;
      const bt = b.lastMessageAt?.toMillis?.() || 0;
      if (at !== bt) return bt - at;
      const an = a.type === 'dm' ? a.username : a.name;
      const bn = b.type === 'dm' ? b.username : b.name;
      return an.localeCompare(bn);
    });
    return all;
  }, [users, groups, convMetas, currentUid]);

  useEffect(() => {
    if (!activeChat || !currentUid) return;
    let colRef;
    if (activeChat.type === 'dm') {
      const id = convoId(currentUid, activeChat.uid);
      colRef = collection(db, 'conversations', id, 'messages');
    } else {
      colRef = collection(db, 'groups', activeChat.id, 'messages');
    }
    const q = query(colRef, orderBy('createdAt', 'asc'));
    const unsub = onSnapshot(q, (snap) => {
      setMessages(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
    });
    return () => unsub();
  }, [activeChat, currentUid]);

  useEffect(() => {
    if (!activeChat || activeChat.type !== 'dm' || !currentUid) return;
    const id = convoId(currentUid, activeChat.uid);
    const unreadFromThem = messages.filter((m) => m.from === activeChat.uid && m.status !== 'read' && m.type !== 'call');
    if (unreadFromThem.length > 0) {
      const batch = writeBatch(db);
      unreadFromThem.forEach((m) => {
        batch.update(doc(db, 'conversations', id, 'messages', m.id), { status: 'read' });
      });
      batch.commit().catch(() => {});
    }
    updateDoc(doc(db, 'conversationMeta', id), { [`unread.${currentUid}`]: 0 }).catch(() => {});
  }, [messages, activeChat, currentUid]);

  useEffect(() => {
    if (!activeChat || activeChat.type !== 'group' || !currentUid) return;
    updateDoc(doc(db, 'groups', activeChat.id), { [`unread.${currentUid}`]: 0 }).catch(() => {});
  }, [activeChat, currentUid, messages.length]);

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [messages]);

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
      await setDoc(doc(db, 'users', cred.user.uid), { username: uname, online: true, lastSeen: serverTimestamp() });
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
    try {
      await updateDoc(doc(db, 'users', currentUid), { online: false, lastSeen: serverTimestamp() });
    } catch {}
    await signOut(auth);
    setActiveChat(null);
    setMessages([]);
    setUsername('');
    setPassword('');
  };

  const handleDraftChange = (val) => {
    setDraft(val);
    if (!activeChat || activeChat.type !== 'dm') return;
    const id = convoId(currentUid, activeChat.uid);
    setDoc(doc(db, 'conversationMeta', id), {
      participants: [currentUid, activeChat.uid],
      typingBy: currentUid,
      typingAt: serverTimestamp(),
    }, { merge: true }).catch(() => {});
    clearTimeout(typingTimeoutRef.current);
    typingTimeoutRef.current = setTimeout(() => {
      updateDoc(doc(db, 'conversationMeta', id), { typingBy: null }).catch(() => {});
    }, 2500);
  };

  const sendMessage = async () => {
    const text = draft.trim();
    if (!text || !activeChat) return;
    setDraft('');
    await sendAnyMessage({ text });
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
      fromName: m.fromName || (m.from === currentUid ? currentUsername : activeChat?.username),
    });
    setSelectedMsgId(null);
  };

  const sendAnyMessage = async (extraFields) => {
    if (!activeChat) return;
    const payload = {
      from: currentUid,
      fromName: currentUsername,
      status: 'sent',
      replyTo: replyTo || null,
      createdAt: serverTimestamp(),
      ...extraFields,
    };
    const preview = extraFields.text || (extraFields.type === 'image' ? '📷 Photo' : extraFields.type === 'audio' ? '🎤 Voice message' : 'Message');

    if (activeChat.type === 'dm') {
      const id = convoId(currentUid, activeChat.uid);
      await addDoc(collection(db, 'conversations', id, 'messages'), payload);
      await setDoc(
        doc(db, 'conversationMeta', id),
        {
          participants: [currentUid, activeChat.uid],
          lastMessage: preview,
          lastMessageAt: serverTimestamp(),
          lastFrom: currentUid,
          typingBy: null,
          [`unread.${activeChat.uid}`]: increment(1),
        },
        { merge: true }
      );
    } else {
      await addDoc(collection(db, 'groups', activeChat.id, 'messages'), payload);
      const updates = {
        lastMessage: preview,
        lastMessageAt: serverTimestamp(),
        lastFrom: currentUid,
      };
      (activeChat.members || []).forEach((uid) => {
        if (uid !== currentUid) updates[`unread.${uid}`] = increment(1);
      });
      await updateDoc(doc(db, 'groups', activeChat.id), updates);
    }
    setReplyTo(null);
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

  const messageRef = (messageId) => {
    if (activeChat.type === 'dm') {
      const id = convoId(currentUid, activeChat.uid);
      return doc(db, 'conversations', id, 'messages', messageId);
    }
    return doc(db, 'groups', activeChat.id, 'messages', messageId);
  };

  const deleteForEveryone = async (messageId) => {
    if (!activeChat) return;
    try {
      await updateDoc(messageRef(messageId), { deleted: true, text: '', imageData: null, audioData: null });
    } catch {}
    setSelectedMsgId(null);
  };

  const toggleReaction = async (m, emoji) => {
    if (!activeChat) return;
    try {
      if (m.reactions?.[currentUid] === emoji) {
        await updateDoc(messageRef(m.id), { [`reactions.${currentUid}`]: deleteField() });
      } else {
        await updateDoc(messageRef(m.id), { [`reactions.${currentUid}`]: emoji });
      }
    } catch {}
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
    if (!file || !activeChat) return;
    try {
      const dataUrl = await compressImage(file);
      if (dataUrl.length > 900000) {
        alert('Ye photo bahut badi hai. Thodi chhoti ya kam resolution wali photo try karein.');
        return;
      }
      await sendAnyMessage({ type: 'image', imageData: dataUrl });
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
          await sendAnyMessage({ type: 'audio', audioData: dataUrl });
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

  const createGroup = async () => {
    const name = newGroupName.trim();
    if (!name || newGroupMembers.size === 0) {
      alert('Group ka naam aur kam se kam ek member chunein.');
      return;
    }
    const members = [currentUid, ...newGroupMembers];
    await addDoc(collection(db, 'groups'), {
      name,
      members,
      createdBy: currentUid,
      createdAt: serverTimestamp(),
      lastMessage: '',
      lastMessageAt: serverTimestamp(),
    });
    setShowNewGroup(false);
    setNewGroupName('');
    setNewGroupMembers(new Set());
  };

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

  useEffect(() => {
    if (callStatus !== 'idle') {
      if (localVideoRef.current) localVideoRef.current.srcObject = localStreamRef.current;
      if (remoteVideoRef.current) remoteVideoRef.current.srcObject = remoteStreamRef.current;
    }
  }, [callStatus, callIsVideo]);

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
    if (!activeChat || activeChat.type !== 'dm') return;
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
        to: activeChat.uid,
        toName: activeChat.username,
        video: withVideo,
        status: 'ringing',
        offer: { type: offerDescription.type, sdp: offerDescription.sdp },
      });

      setCurrentCallId(callDocRef.id);
      setCallStatus('calling');
      setCallIsVideo(withVideo);
      setCallPeerName(activeChat.username);
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

  const formatListTime = (ts) => {
    if (!ts?.toDate) return '';
    const d = ts.toDate();
    const now = new Date();
    const sameDay = d.toDateString() === now.toDateString();
    if (sameDay) return d.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' });
    return d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short' });
  };

  const formatLastSeen = (ts) => {
    if (!ts?.toDate) return '';
    return 'last seen ' + ts.toDate().toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' });
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

  const activeContactInfo = activeChat?.type === 'dm' ? users.find((u) => u.uid === activeChat.uid) : null;
  const activeMeta = activeChat?.type === 'dm' ? convMetas[convoId(currentUid, activeChat.uid)] : null;
  const isTyping = activeMeta?.typingBy === activeChat?.uid && activeMeta?.typingAt && Date.now() - activeMeta.typingAt.toMillis() < 4000;

  if (authLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#0B141A]">
        <div className="text-[#8696A0] italic tracking-wide">connecting…</div>
      </div>
    );
  }

  if (screen === 'login' || screen === 'signup') {
    const isLogin = screen === 'login';
    return (
      <div className="min-h-screen bg-[#0B141A] flex items-center justify-center p-6">
        <div className="w-full max-w-sm">
          <div className="flex items-center gap-2 justify-center mb-8">
            <MessageCircle className="text-[#00A884]" size={28} strokeWidth={1.75} />
            <h1 className="text-3xl text-[#E9EDEF] tracking-tight" style={{ fontFamily: 'Fraunces, Georgia, serif' }}>
              Correspond
            </h1>
          </div>

          <div className="bg-[#202C33] rounded-lg border border-[#2A3942] p-7 shadow-xl">
            <h2 className="text-[#E9EDEF] text-sm uppercase tracking-[0.15em] mb-6 font-medium">
              {isLogin ? 'Sign in' : 'Create account'}
            </h2>

            <form onSubmit={isLogin ? handleLogin : handleSignup} className="space-y-4">
              <div>
                <label className="block text-[11px] uppercase tracking-wider text-[#8696A0] mb-1.5">Username</label>
                <input
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  className="w-full bg-[#0B141A] border border-[#2A3942] rounded-md px-3 py-2.5 text-[#E9EDEF] outline-none focus:border-[#00A884] transition-colors"
                  placeholder="e.g. aarav"
                  autoComplete="off"
                />
              </div>
              <div>
                <label className="block text-[11px] uppercase tracking-wider text-[#8696A0] mb-1.5">Password</label>
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="w-full bg-[#0B141A] border border-[#2A3942] rounded-md px-3 py-2.5 text-[#E9EDEF] outline-none focus:border-[#00A884] transition-colors"
                  placeholder="kam se kam 6 characters"
                />
              </div>

              {error && <p className="text-[#F15C6D] text-sm">{error}</p>}

              <button
                type="submit"
                disabled={busy}
                className="w-full bg-[#00A884] hover:bg-[#02c398] disabled:opacity-50 text-[#0B141A] font-semibold rounded-md py-2.5 flex items-center justify-center gap-2 transition-colors"
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
              className="w-full text-center text-[#8696A0] text-sm mt-5 hover:text-[#E9EDEF] transition-colors"
            >
              {isLogin ? 'Naya account banayen' : 'Pehle se account hai? Sign in karein'}
            </button>
          </div>
        </div>
      </div>
    );
  }

  const visibleMessages = messages.filter((m) => !hiddenIds.has(m.id));

  const MessageBubble = ({ m }) => {
    const mine = m.from === currentUid;
    if (m.type === 'call') {
      return (
        <div className="flex justify-center">
          <div className="flex items-center gap-2 bg-[#202C33] border border-[#2A3942] rounded-full px-4 py-1.5 text-[#8696A0] text-xs">
            {m.video ? <Video size={13} /> : <Phone size={13} />}
            {callLabel(m)}
            <span className="opacity-60">· {formatTime(m.createdAt)}</span>
          </div>
        </div>
      );
    }
    const reactionCounts = {};
    if (m.reactions) {
      Object.values(m.reactions).forEach((emo) => {
        reactionCounts[emo] = (reactionCounts[emo] || 0) + 1;
      });
    }
    return (
      <div className={`flex flex-col ${mine ? 'items-end' : 'items-start'}`}>
        <div
          onClick={() => setSelectedMsgId(selectedMsgId === m.id ? null : m.id)}
          className={`relative max-w-[75%] rounded-lg px-3 py-2 cursor-pointer ${
            mine ? 'bg-[#005C4B] text-[#E9EDEF] rounded-tr-none' : 'bg-[#202C33] text-[#E9EDEF] rounded-tl-none'
          }`}
        >
          {activeChat.type === 'group' && !mine && (
            <div className="text-[#00A884] text-xs font-medium mb-0.5">{m.fromName}</div>
          )}
          {m.replyTo && !m.deleted && (
            <div className="mb-1.5 pl-2 border-l-2 border-[#00A884] text-xs opacity-80 bg-black/10 rounded px-1.5 py-1">
              <div className="font-medium">{m.replyTo.fromName}</div>
              <div className="truncate max-w-[220px]">{m.replyTo.preview}</div>
            </div>
          )}
          {m.deleted ? (
            <div className="text-sm italic opacity-70">Ye message delete kar diya gaya</div>
          ) : m.type === 'image' ? (
            <img src={m.imageData} alt="photo" className="rounded max-w-[220px] max-h-72 object-cover" />
          ) : m.type === 'audio' ? (
            <audio controls src={m.audioData} className="max-w-[220px]" />
          ) : (
            <div className="text-sm leading-relaxed break-words">{m.text}</div>
          )}
          <div className={`flex items-center justify-end gap-1 text-[10px] mt-1 ${mine ? 'text-[#8FBFB2]' : 'text-[#8696A0]'}`}>
            {formatTime(m.createdAt)}
            {mine && activeChat.type === 'dm' && (m.status === 'read' ? <CheckCheck size={13} className="text-[#53BDEB]" /> : <Check size={13} />)}
          </div>
        </div>
        {Object.keys(reactionCounts).length > 0 && (
          <div className="flex gap-1 mt-1">
            {Object.entries(reactionCounts).map(([emo, count]) => (
              <span key={emo} className="bg-[#202C33] border border-[#2A3942] rounded-full px-1.5 py-0.5 text-xs">
                {emo} {count > 1 ? count : ''}
              </span>
            ))}
          </div>
        )}
        {selectedMsgId === m.id && (
          <div className="mt-1">
            <div className="flex gap-2 mb-1">
              {REACTION_EMOJIS.map((emo) => (
                <button key={emo} onClick={() => toggleReaction(m, emo)} className="text-base hover:scale-125 transition-transform">
                  {emo}
                </button>
              ))}
            </div>
            <div className="flex gap-3 text-[11px]">
              <button onClick={() => startReply(m)} className="text-[#00A884] underline">Reply</button>
              <button onClick={() => hideForMe(m.id)} className="text-[#8696A0] underline">Delete for me</button>
              {mine && !m.deleted && (
                <button onClick={() => deleteForEveryone(m.id)} className="text-[#F15C6D] underline">Delete for everyone</button>
              )}
            </div>
          </div>
        )}
      </div>
    );
  };

  const ChatHeader = () => (
    <>
      <div className="w-9 h-9 rounded-full bg-[#2A3942] flex items-center justify-center text-[#E9EDEF] font-medium text-sm relative">
        {activeChat.type === 'group' ? <Users size={16} /> : activeChat.username.slice(0, 2).toUpperCase()}
        {activeChat.type === 'dm' && activeContactInfo?.online && (
          <span className="absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 rounded-full bg-[#00A884] border-2 border-[#0B141A]" />
        )}
      </div>
      <div>
        <div className="text-[#E9EDEF] font-medium">{activeChat.type === 'group' ? activeChat.name : activeChat.username}</div>
        {activeChat.type === 'dm' && (
          <div className="text-[#8696A0] text-xs">
            {isTyping ? <span className="text-[#00A884]">typing…</span> : activeContactInfo?.online ? 'online' : activeContactInfo?.lastSeen ? formatLastSeen(activeContactInfo.lastSeen) : ''}
          </div>
        )}
        {activeChat.type === 'group' && (
          <div className="text-[#8696A0] text-xs">{(activeChat.members || []).length} members</div>
        )}
      </div>
    </>
  );

  return (
    <div className="min-h-screen bg-[#0B141A] flex">
      <div className="w-full sm:w-80 border-r border-[#2A3942] flex flex-col">
        <div className="p-4 border-b border-[#2A3942] flex items-center justify-between bg-[#202C33]">
          <div className="flex items-center gap-2">
            <MessageCircle className="text-[#00A884]" size={22} strokeWidth={1.75} />
            <span className="text-[#E9EDEF] text-lg" style={{ fontFamily: 'Fraunces, Georgia, serif' }}>Correspond</span>
          </div>
          <div className="flex items-center gap-4">
            <button onClick={() => setShowNewGroup(true)} title="New group" className="text-[#8696A0] hover:text-[#00A884] transition-colors">
              <Users size={19} />
            </button>
            <button onClick={handleLogout} title="Logout" className="text-[#8696A0] hover:text-[#F15C6D] transition-colors">
              <LogOut size={19} />
            </button>
          </div>
        </div>

        <div className="px-4 py-2 text-[#8696A0] text-xs uppercase tracking-wider bg-[#111B21]">
          Signed in as <span className="text-[#E9EDEF]">{currentUsername}</span>
        </div>

        <div className="flex-1 overflow-y-auto">
          {chatList.length === 0 && (
            <div className="p-5 text-[#8696A0] text-sm leading-relaxed">
              Abhi koi chat nahi. Kisi aur ko is website ka link bhejein — sign up karte hi wo yahan aa jayega.
            </div>
          )}
          {chatList.map((c) => {
            const isActive = activeChat && ((c.type === 'dm' && activeChat.type === 'dm' && activeChat.uid === c.uid) || (c.type === 'group' && activeChat.type === 'group' && activeChat.id === c.id));
            return (
              <button
                key={c.key}
                onClick={() =>
                  setActiveChat(
                    c.type === 'dm'
                      ? { type: 'dm', uid: c.uid, username: c.username }
                      : { type: 'group', id: c.id, name: c.name, members: groups.find((g) => g.id === c.id)?.members || [] }
                  )
                }
                className={`w-full text-left px-4 py-3 flex items-center gap-3 border-b border-[#202C33] transition-colors ${
                  isActive ? 'bg-[#2A3942]' : 'hover:bg-[#182229]'
                }`}
              >
                <div className="w-11 h-11 rounded-full bg-[#2A3942] flex items-center justify-center text-[#E9EDEF] font-medium text-sm shrink-0 relative">
                  {c.type === 'group' ? <Users size={18} /> : c.username.slice(0, 2).toUpperCase()}
                  {c.type === 'dm' && c.online && (
                    <span className="absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full bg-[#00A884] border-2 border-[#111B21]" />
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between gap-2">
                    <div className="text-[#E9EDEF] text-sm font-medium truncate">{c.type === 'dm' ? c.username : c.name}</div>
                    {c.lastMessageAt && <div className="text-[10px] text-[#8696A0] shrink-0">{formatListTime(c.lastMessageAt)}</div>}
                  </div>
                  <div className="flex items-center justify-between gap-2">
                    <div className="text-[#8696A0] text-xs truncate">
                      {c.type === 'dm' && c.typing ? <span className="text-[#00A884]">typing…</span> : c.lastMessage || 'Naya contact'}
                    </div>
                    {c.unread > 0 && (
                      <span className="bg-[#00A884] text-[#0B141A] text-[10px] font-bold rounded-full min-w-[18px] h-[18px] flex items-center justify-center px-1 shrink-0">
                        {c.unread}
                      </span>
                    )}
                  </div>
                </div>
              </button>
            );
          })}
        </div>
      </div>

      <div className="hidden sm:flex flex-1 flex-col">
        {!activeChat ? (
          <div className="flex-1 flex items-center justify-center text-[#8696A0]">
            <div className="text-center max-w-xs">
              <MessageCircle size={32} className="mx-auto mb-3 text-[#2A3942]" strokeWidth={1.5} />
              <p className="text-sm">Baat karne ke liye ek chat chunein</p>
            </div>
          </div>
        ) : (
          <>
            <div className="px-6 py-3 border-b border-[#2A3942] flex items-center gap-3 bg-[#202C33]">
              <ChatHeader />
              {activeChat.type === 'dm' && callStatus === 'idle' && (
                <div className="flex items-center gap-4 ml-auto">
                  <button onClick={() => startCall(false)} title="Audio call" className="text-[#8696A0] hover:text-[#00A884] transition-colors">
                    <Phone size={18} />
                  </button>
                  <button onClick={() => startCall(true)} title="Video call" className="text-[#8696A0] hover:text-[#00A884] transition-colors">
                    <Video size={19} />
                  </button>
                </div>
              )}
            </div>

            <div ref={scrollRef} className="flex-1 overflow-y-auto px-6 py-5 space-y-3 bg-[#0B141A]">
              {visibleMessages.length === 0 && (
                <p className="text-[#8696A0] text-sm text-center mt-10">Abhi koi message nahi. Sabse pehla message aap hi bhejein.</p>
              )}
              {visibleMessages.map((m) => <MessageBubble key={m.id} m={m} />)}
            </div>

            {replyTo && (
              <div className="px-6 pt-2 pb-1 flex items-center gap-2 border-t border-[#2A3942] bg-[#202C33]">
                <div className="flex-1 border-l-2 border-[#00A884] pl-2 py-0.5 min-w-0">
                  <div className="text-[#00A884] text-xs font-medium">{replyTo.fromName}</div>
                  <div className="text-[#8696A0] text-xs truncate">{replyTo.preview}</div>
                </div>
                <button onClick={() => setReplyTo(null)} className="text-[#8696A0] shrink-0"><X size={16} /></button>
              </div>
            )}
            <div className={`p-4 flex items-center gap-2 bg-[#202C33] ${replyTo ? '' : 'border-t border-[#2A3942]'}`}>
              <input ref={fileInputRef} type="file" accept="image/*" onChange={handleImagePick} className="hidden" />
              <button onClick={() => fileInputRef.current?.click()} className="text-[#8696A0] hover:text-[#00A884] transition-colors shrink-0" title="Photo bhejein">
                <Paperclip size={19} />
              </button>
              <button
                onClick={recording ? stopRecording : startRecording}
                className={`shrink-0 transition-colors ${recording ? 'text-[#F15C6D]' : 'text-[#8696A0] hover:text-[#00A884]'}`}
                title={recording ? 'Recording rokein aur bhejein' : 'Voice message'}
              >
                {recording ? <Square size={18} /> : <Mic size={19} />}
              </button>
              <input
                value={draft}
                onChange={(e) => handleDraftChange(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && sendMessage()}
                placeholder="Message likhein…"
                className="flex-1 bg-[#2A3942] border border-[#3B4A54] rounded-full px-4 py-2.5 text-[#E9EDEF] outline-none focus:border-[#00A884] transition-colors text-sm"
              />
              <button
                onClick={sendMessage}
                disabled={!draft.trim()}
                className="bg-[#00A884] disabled:opacity-40 disabled:cursor-not-allowed hover:bg-[#02c398] text-[#0B141A] rounded-full w-10 h-10 flex items-center justify-center transition-colors shrink-0"
              >
                <Send size={16} />
              </button>
            </div>
          </>
        )}
      </div>

      {activeChat && (
        <div className="sm:hidden fixed inset-0 bg-[#0B141A] flex flex-col z-10">
          <div className="px-3 py-3 border-b border-[#2A3942] flex items-center gap-3 bg-[#202C33]">
            <button onClick={() => setActiveChat(null)} className="text-[#8696A0]">←</button>
            <ChatHeader />
            {activeChat.type === 'dm' && callStatus === 'idle' && (
              <div className="flex items-center gap-4 ml-auto mr-1">
                <button onClick={() => startCall(false)} className="text-[#8696A0]"><Phone size={19} /></button>
                <button onClick={() => startCall(true)} className="text-[#8696A0]"><Video size={20} /></button>
              </div>
            )}
          </div>
          <div ref={scrollRef} className="flex-1 overflow-y-auto px-3 py-4 space-y-3">
            {visibleMessages.map((m) => <MessageBubble key={m.id} m={m} />)}
          </div>
          {replyTo && (
            <div className="px-3 pt-2 pb-1 flex items-center gap-2 border-t border-[#2A3942] bg-[#202C33]">
              <div className="flex-1 border-l-2 border-[#00A884] pl-2 py-0.5 min-w-0">
                <div className="text-[#00A884] text-xs font-medium">{replyTo.fromName}</div>
                <div className="text-[#8696A0] text-xs truncate">{replyTo.preview}</div>
              </div>
              <button onClick={() => setReplyTo(null)} className="text-[#8696A0] shrink-0"><X size={16} /></button>
            </div>
          )}
          <div className={`p-3 flex items-center gap-2 bg-[#202C33] ${replyTo ? '' : 'border-t border-[#2A3942]'}`}>
            <button onClick={() => fileInputRef.current?.click()} className="text-[#8696A0] shrink-0"><Paperclip size={18} /></button>
            <button onClick={recording ? stopRecording : startRecording} className={`shrink-0 ${recording ? 'text-[#F15C6D]' : 'text-[#8696A0]'}`}>
              {recording ? <Square size={17} /> : <Mic size={18} />}
            </button>
            <input
              value={draft}
              onChange={(e) => handleDraftChange(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && sendMessage()}
              placeholder="Message likhein…"
              className="flex-1 bg-[#2A3942] border border-[#3B4A54] rounded-full px-4 py-2 text-[#E9EDEF] outline-none text-sm"
            />
            <button onClick={sendMessage} disabled={!draft.trim()} className="bg-[#00A884] disabled:opacity-40 text-[#0B141A] rounded-full w-9 h-9 flex items-center justify-center shrink-0">
              <Send size={15} />
            </button>
          </div>
        </div>
      )}

      {showNewGroup && (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-6">
          <div className="bg-[#202C33] rounded-lg border border-[#2A3942] w-full max-w-sm p-5 max-h-[80vh] flex flex-col">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-[#E9EDEF] font-medium">Naya group</h3>
              <button onClick={() => setShowNewGroup(false)} className="text-[#8696A0]"><X size={18} /></button>
            </div>
            <input
              value={newGroupName}
              onChange={(e) => setNewGroupName(e.target.value)}
              placeholder="Group ka naam"
              className="w-full bg-[#0B141A] border border-[#2A3942] rounded-md px-3 py-2.5 text-[#E9EDEF] outline-none focus:border-[#00A884] mb-4 text-sm"
            />
            <div className="text-[#8696A0] text-xs uppercase tracking-wider mb-2">Members chunein</div>
            <div className="flex-1 overflow-y-auto space-y-1 mb-4">
              {users.map((u) => (
                <label key={u.uid} className="flex items-center gap-3 px-2 py-2 rounded hover:bg-[#2A3942] cursor-pointer">
                  <input
                    type="checkbox"
                    checked={newGroupMembers.has(u.uid)}
                    onChange={() => {
                      setNewGroupMembers((prev) => {
                        const next = new Set(prev);
                        if (next.has(u.uid)) next.delete(u.uid);
                        else next.add(u.uid);
                        return next;
                      });
                    }}
                    className="accent-[#00A884]"
                  />
                  <span className="text-[#E9EDEF] text-sm">{u.username}</span>
                </label>
              ))}
              {users.length === 0 && <div className="text-[#8696A0] text-sm">Koi contact nahi mila.</div>}
            </div>
            <button onClick={createGroup} className="w-full bg-[#00A884] hover:bg-[#02c398] text-[#0B141A] font-semibold rounded-md py-2.5">
              Group banayen
            </button>
          </div>
        </div>
      )}

      {incomingCall && (
        <div className="fixed inset-0 bg-[#0B141A]/97 flex flex-col items-center justify-center z-50 p-6">
          <div className="w-20 h-20 rounded-full bg-[#2A3942] flex items-center justify-center text-[#E9EDEF] text-2xl font-medium mb-5">
            {incomingCall.fromName.slice(0, 2).toUpperCase()}
          </div>
          <div className="text-[#E9EDEF] text-lg font-medium mb-1">{incomingCall.fromName}</div>
          <div className="text-[#8696A0] text-sm mb-10">{incomingCall.video ? 'Video call...' : 'Audio call...'}</div>
          <div className="flex items-center gap-8">
            <button onClick={rejectCall} className="w-14 h-14 rounded-full bg-[#F15C6D] flex items-center justify-center text-[#0B141A]"><PhoneOff size={22} /></button>
            <button onClick={acceptCall} className="w-14 h-14 rounded-full bg-[#00A884] flex items-center justify-center text-[#0B141A]"><Phone size={22} /></button>
          </div>
        </div>
      )}

      {callStatus !== 'idle' && (
        <div className="fixed inset-0 bg-[#0B141A] flex flex-col items-center justify-center z-50">
          {callIsVideo ? (
            <div className="relative w-full h-full" ref={pipContainerRef}>
              <video ref={remoteVideoRef} autoPlay playsInline className="w-full h-full object-cover bg-[#202C33]" />
              <div
                ref={pipElRef}
                onMouseDown={onPipMouseDown}
                onTouchStart={onPipTouchStart}
                style={{ position: 'absolute', left: 0, top: 0, touchAction: 'none' }}
                className={`rounded-lg border border-[#2A3942] overflow-hidden cursor-grab active:cursor-grabbing select-none ${pipLarge ? 'w-44 h-64' : 'w-28 h-40'}`}
              >
                <video ref={localVideoRef} autoPlay playsInline muted className="w-full h-full object-cover pointer-events-none" />
              </div>
              <div className="absolute top-6 left-0 right-0 text-center pointer-events-none">
                <div className="text-[#E9EDEF] font-medium">{callPeerName}</div>
                <div className="text-[#8696A0] text-xs">{callStatus === 'calling' ? 'Calling…' : 'In call'}</div>
              </div>
            </div>
          ) : (
            <>
              <video ref={remoteVideoRef} autoPlay playsInline className="hidden" />
              <video ref={localVideoRef} autoPlay playsInline muted className="hidden" />
              <div className="w-24 h-24 rounded-full bg-[#2A3942] flex items-center justify-center text-[#E9EDEF] text-3xl font-medium mb-5">
                {callPeerName.slice(0, 2).toUpperCase()}
              </div>
              <div className="text-[#E9EDEF] text-lg font-medium mb-1">{callPeerName}</div>
              <div className="text-[#8696A0] text-sm mb-10">{callStatus === 'calling' ? 'Calling…' : 'In call'}</div>
            </>
          )}
          <div className="absolute bottom-10 left-0 right-0 flex items-center justify-center gap-6">
            <button onClick={toggleMic} className="w-12 h-12 rounded-full bg-[#2A3942] flex items-center justify-center text-[#E9EDEF]">
              {micOn ? <Mic size={19} /> : <MicOff size={19} />}
            </button>
            <button onClick={hangUp} className="w-14 h-14 rounded-full bg-[#F15C6D] flex items-center justify-center text-[#0B141A]"><PhoneOff size={22} /></button>
          </div>
        </div>
      )}
    </div>
  );
}
