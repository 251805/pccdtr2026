/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { initializeApp } from 'firebase/app';
import { 
  getAuth, 
  signInWithPopup, 
  GoogleAuthProvider, 
  onAuthStateChanged, 
  User 
} from 'firebase/auth';
import firebaseConfig from '../../firebase-applet-config.json';

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);

const provider = new GoogleAuthProvider();
// Request Sheets and Drive.file scopes
provider.addScope('https://www.googleapis.com/auth/spreadsheets');
provider.addScope('https://www.googleapis.com/auth/drive.file');

let isSigningIn = false;
let cachedAccessToken: string | null = null;
let spreadsheetId: string | null = null;

// Grab saved Spreadsheet ID and access token from local storage
if (typeof window !== 'undefined') {
  spreadsheetId = localStorage.getItem('a10dance_spreadsheet_id');
  cachedAccessToken = localStorage.getItem('a10dance_access_token');
}

export const setSpreadsheetIdToCache = (id: string | null) => {
  spreadsheetId = id;
  if (id) {
    localStorage.setItem('a10dance_spreadsheet_id', id);
  } else {
    localStorage.removeItem('a10dance_spreadsheet_id');
  }
};

export const getSpreadsheetIdFromCache = (): string | null => {
  return spreadsheetId;
};

export const initAuth = (
  onAuthSuccess?: (user: User, token: string) => void,
  onAuthFailure?: () => void
) => {
  return onAuthStateChanged(auth, async (user: User | null) => {
    if (user) {
      if (cachedAccessToken) {
        if (onAuthSuccess) onAuthSuccess(user, cachedAccessToken);
      } else if (!isSigningIn) {
        cachedAccessToken = null;
        if (onAuthFailure) onAuthFailure();
      }
    } else {
      cachedAccessToken = null;
      if (onAuthFailure) onAuthFailure();
    }
  });
};

export const googleSignIn = async (): Promise<{ user: User; accessToken: string } | null> => {
  if (isSigningIn) {
    console.warn('Sign-in already in progress, ignoring duplicate request.');
    return null;
  }
  try {
    isSigningIn = true;
    const result = await signInWithPopup(auth, provider);
    const credential = GoogleAuthProvider.credentialFromResult(result);
    if (!credential?.accessToken) {
      throw new Error('Failed to retrieve access token from Google identity provider.');
    }

    cachedAccessToken = credential.accessToken;
    if (typeof window !== 'undefined') {
      localStorage.setItem('a10dance_access_token', credential.accessToken);
    }
    
    // Automatically post the token to our Express backend so it can handle scan queries
    if (spreadsheetId) {
      await fetch('/api/auth/save-token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ accessToken: cachedAccessToken, spreadsheetId })
      }).catch(err => console.error('Failed to register active authentication on the backend server:', err));
    }

    return { user: result.user, accessToken: cachedAccessToken };
  } catch (error: any) {
    console.error('Sign in error details:', error);
    if (
      error?.code === 'auth/cancelled-popup-request' ||
      error?.code === 'auth/popup-closed-by-user' ||
      error?.message?.includes('cancelled-popup-request') ||
      error?.message?.includes('popup-closed-by-user')
    ) {
      console.log('User closed or cancelled the authentication popup workflow.');
      return null;
    }
    throw error;
  } finally {
    isSigningIn = false;
  }
};

export const getAccessToken = async (): Promise<string | null> => {
  return cachedAccessToken;
};

export const syncTokenToBackend = async (id: string): Promise<boolean> => {
  if (!cachedAccessToken) return false;
  try {
    setSpreadsheetIdToCache(id);
    const res = await fetch('/api/auth/save-token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ accessToken: cachedAccessToken, spreadsheetId: id })
    });
    return res.ok;
  } catch {
    return false;
  }
};

export const logout = async () => {
  await auth.signOut();
  cachedAccessToken = null;
  spreadsheetId = null;
  if (typeof window !== 'undefined') {
    localStorage.removeItem('a10dance_access_token');
    localStorage.removeItem('a10dance_spreadsheet_id');
  }
  // Notify backend to drop token context and switch to standby mode
  await fetch('/api/auth/clear-token', { method: 'POST' }).catch(() => {});
};
