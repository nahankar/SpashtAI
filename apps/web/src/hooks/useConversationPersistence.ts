import { useState, useEffect, useCallback, useRef } from 'react';
import { getAuthHeaders } from '@/lib/api-client';

interface ConversationMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: string;
}

interface ConversationState {
  sessionId: string | null;
  messages: ConversationMessage[];
  isLoading: boolean;
  error: string | null;
}

interface ConversationAPI {
  loadConversation: (sessionId: string) => Promise<void>;
  addMessage: (role: 'user' | 'assistant', content: string, streamId?: string) => Promise<void>;
  upsertStreamingMessage: (role: 'user' | 'assistant', content: string, streamId: string) => void;
  clearMessages: () => void;
  subscribeToUpdates: (sessionId: string) => () => void;
}

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:4000';
const WS_BASE_URL = API_BASE_URL.replace('http', 'ws');

export function useConversationPersistence(): ConversationState & ConversationAPI {
  const [state, setState] = useState<ConversationState>({
    sessionId: null,
    messages: [],
    isLoading: false,
    error: null
  });

  const [ws, setWs] = useState<WebSocket | null>(null);
  const sessionIdRef = useRef<string | null>(null);

  useEffect(() => {
    sessionIdRef.current = state.sessionId;
  }, [state.sessionId]);

  // Load conversation from server
  const loadConversation = useCallback(async (sessionId: string) => {
    setState(prev => ({ ...prev, isLoading: true, error: null, sessionId }));
    
    try {
      const response = await fetch(`${API_BASE_URL}/sessions/${sessionId}/conversation`, {
        headers: getAuthHeaders(),
      });
      
      if (response.ok) {
        const data = await response.json();
        setState(prev => ({
          ...prev,
          messages: data.messages || [],
          isLoading: false
        }));
      } else if (response.status === 404) {
        // New session, no conversation yet
        setState(prev => ({
          ...prev,
          messages: [],
          isLoading: false
        }));
      } else {
        throw new Error(`Failed to load conversation: ${response.statusText}`);
      }
    } catch (error) {
      console.error('Error loading conversation:', error);
      setState(prev => ({
        ...prev,
        error: error instanceof Error ? error.message : 'Failed to load conversation',
        isLoading: false
      }));
    }
  }, []);

  // Update in-progress streaming transcript (UI only — not persisted until final)
  const upsertStreamingMessage = useCallback(
    (role: 'user' | 'assistant', content: string, streamId: string) => {
      setState((prev) => {
        const idx = prev.messages.findIndex((m) => m.id === streamId)
        if (idx >= 0) {
          const next = [...prev.messages]
          next[idx] = { ...next[idx], content }
          return { ...prev, messages: next }
        }
        return {
          ...prev,
          messages: [
            ...prev.messages,
            { id: streamId, role, content, timestamp: new Date().toISOString() },
          ],
        }
      })
    },
    [],
  )

  // Add message to conversation (final utterance — persisted to server)
  const addMessage = useCallback(async (role: 'user' | 'assistant', content: string, streamId?: string) => {
    const activeSessionId = sessionIdRef.current;
    if (!activeSessionId) {
      console.warn('Cannot add message: no session ID');
      return;
    }

    const timestamp = new Date().toISOString();
    let tempId = streamId || `temp_${Date.now()}`;

    setState((prev) => {
      if (streamId) {
        const idx = prev.messages.findIndex((m) => m.id === streamId);
        if (idx >= 0) {
          tempId = streamId;
          const next = [...prev.messages];
          next[idx] = { ...next[idx], content, timestamp };
          return { ...prev, messages: next };
        }
      }
      return {
        ...prev,
        messages: [...prev.messages, { id: tempId, role, content, timestamp }],
      };
    });

    try {
      const response = await fetch(`${API_BASE_URL}/sessions/${activeSessionId}/messages`, {
        method: 'POST',
        headers: getAuthHeaders(),
        body: JSON.stringify({ role, content, timestamp }),
      });

      if (!response.ok) {
        throw new Error(`Failed to save message: ${response.statusText}`);
      }

      const savedMessage = await response.json();

      setState((prev) => ({
        ...prev,
        messages: prev.messages.map((msg) =>
          msg.id === tempId ? { ...savedMessage.message, id: savedMessage.message.id } : msg,
        ),
      }));
    } catch (error) {
      console.error('Error saving message:', error);
      setState((prev) => ({
        ...prev,
        messages: prev.messages.filter((msg) => msg.id !== tempId),
        error: error instanceof Error ? error.message : 'Failed to save message',
      }));
    }
  }, []);

  // Clear messages
  const clearMessages = useCallback(() => {
    setState(prev => ({
      ...prev,
      messages: []
    }));
  }, []);

  // Subscribe to real-time WebSocket updates
  const subscribeToUpdates = useCallback((sessionId: string) => {
    if (ws) {
      ws.close();
    }

    try {
      const websocket = new WebSocket(WS_BASE_URL);
      
      websocket.onopen = () => {
        console.log('🔌 Connected to conversation WebSocket');
        websocket.send(JSON.stringify({ type: 'subscribe', sessionId }));
        setWs(websocket);
      };

      websocket.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          
          if (data.type === 'conversation_update' && data.sessionId === sessionId) {
            if (data.action === 'message_added') {
              setState(prev => {
                const exists = prev.messages.some(
                  (msg) =>
                    msg.id === data.message.id ||
                    (msg.role === data.message.role && msg.content === data.message.content),
                );
                if (exists) return prev;
                
                return {
                  ...prev,
                  messages: [...prev.messages, data.message]
                };
              });
            } else if (data.action === 'session_state_changed') {
              console.log('Session state updated:', data.state);
            }
          }
        } catch (error) {
          console.error('Error parsing WebSocket message:', error);
        }
      };

      websocket.onclose = () => {
        console.log('🔌 Disconnected from conversation WebSocket');
        setWs(null);
      };

      websocket.onerror = (error) => {
        console.error('WebSocket error:', error);
      };

      // Cleanup function
      return () => {
        websocket.close();
        setWs(null);
      };

    } catch (error) {
      console.error('Failed to create WebSocket connection:', error);
      return () => {}; // No-op cleanup
    }
  }, [ws, WS_BASE_URL]);

  // Cleanup WebSocket on unmount
  useEffect(() => {
    return () => {
      if (ws) {
        ws.close();
      }
    };
  }, [ws]);

  return {
    ...state,
    loadConversation,
    addMessage,
    upsertStreamingMessage,
    clearMessages,
    subscribeToUpdates
  };
}