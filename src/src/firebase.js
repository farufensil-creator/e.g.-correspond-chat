import { initializeApp } from 'firebase/app';
import { getAuth } from 'firebase/auth';
import { getFirestore } from 'firebase/firestore';

const firebaseConfig = {
  apiKey: 'AIzaSyCCazfu2aXc6pWjPeY9YK3HexbE24TNqdo',
  authDomain: 'sherag-e8d37.firebaseapp.com',
  projectId: 'sherag-e8d37',
  storageBucket: 'sherag-e8d37.firebasestorage.app',
  messagingSenderId: '732963616606',
  appId: '1:732963616606:web:7e09ea51c41104608281cf',
};

const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app);

export const usernameToEmail = (username) =>
  `${username.trim().toLowerCase()}@correspond.local`;
