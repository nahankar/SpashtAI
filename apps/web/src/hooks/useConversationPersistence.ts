import { useState, useEffect, useCallback } from 'react';
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
  addMessage: (role: 'user' | 'assistant', content: string) => Promise<void>;
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

  // Add message to conversation
  const addMessage = useCallback(async (role: 'user' | 'assistant', content: string) => {
    if (!state.sessionId) {
      console.warn('Cannot add message: no session ID');
      return;
    }

    // Optimistically update UI
    const tempMessage: ConversationMessage = {
      id: `temp_${Date.now()}`,
      role,
      content,
      timestamp: new Date().toISOString()
    };

    setState(prev => ({
      ...prev,
      messages: [...prev.messages, tempMessage]
    }));

    try {
      const response = await fetch(`${API_BASE_URL}/sessions/${state.sessionId}/messages`, {
        method: 'POST',
        headers: getAuthHeaders(),
        body: JSON.stringify({
          role,
          content,
          timestamp: tempMessage.timestamp
        })
      });

      if (!response.ok) {
        throw new Error(`Failed to save message: ${response.statusText}`);
      }

      const savedMessage = await response.json();
      
      // Replace temp message with saved one
      setState(prev => ({
        ...prev,
        messages: prev.messages.map(msg => 
          msg.id === tempMessage.id 
            ? { ...savedMessage.message, id: savedMessage.message.id }
            : msg
        )
      }));

    } catch (error) {
      console.error('Error saving message:', error);
      
      // Remove failed message and show error
      setState(prev => ({
        ...prev,
        messages: prev.messages.filter(msg => msg.id !== tempMessage.id),
        error: error instanceof Error ? error.message : 'Failed to save message'
      }));
    }
  }, [state.sessionId]);

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
                // Check if message already exists to avoid duplicates
                const exists = prev.messages.some(msg => msg.id === data.message.id);
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
    clearMessages,
    subscribeToUpdates
  };
}