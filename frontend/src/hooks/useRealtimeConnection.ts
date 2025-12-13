import { useEffect, useState, useCallback } from 'react';
import { realtimeSocket, WS_EVENTS } from '@/services/websocket';
import { getAuthToken } from '@/services/api';
import { useToast } from '@/components/ui/use-toast';

export function useRealtimeConnection() {
  const [isConnected, setIsConnected] = useState(false);
  const [isConnecting, setIsConnecting] = useState(false);
  const { toast } = useToast();

  const connect = useCallback(async () => {
    const token = getAuthToken();
    if (!token) {
      console.log('[Realtime] No auth token, skipping connection');
      return;
    }

    setIsConnecting(true);
    try {
      await realtimeSocket.connect(token);
    } catch (error) {
      console.error('[Realtime] Connection failed:', error);
      toast({
        title: 'Conexão em tempo real',
        description: 'Não foi possível conectar. Tentando novamente...',
        variant: 'destructive',
      });
    } finally {
      setIsConnecting(false);
    }
  }, [toast]);

  useEffect(() => {
    const unsubConnect = realtimeSocket.onConnect(() => {
      setIsConnected(true);
      console.log('[Realtime] Connection established');
    });

    const unsubDisconnect = realtimeSocket.onDisconnect(() => {
      setIsConnected(false);
      console.log('[Realtime] Connection lost');
    });

    connect();

    return () => {
      unsubConnect();
      unsubDisconnect();
    };
  }, [connect]);

  return { isConnected, isConnecting };
}

export function useRealtimeSubscription<T = any>(
  eventType: string,
  handler: (data: T) => void,
  dependencies: any[] = []
) {
  useEffect(() => {
    const unsubscribe = realtimeSocket.subscribe(eventType, handler);
    return unsubscribe;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [eventType, ...dependencies]);
}

export function useRealtimeMetrics() {
  const [metrics, setMetrics] = useState({
    activeConversations: 0,
    onlineOperators: 0,
    availableLines: 0,
  });

  useRealtimeSubscription(WS_EVENTS.METRICS_UPDATE, (data: any) => {
    if (data.metrics) {
      setMetrics(data.metrics);
    }
  });

  return metrics;
}
