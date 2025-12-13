import { useState, useEffect, useCallback, useRef } from "react";
import { Plus, Send, FileText, MessageCircle, ArrowRight, ArrowLeft, Loader2, Wifi, WifiOff } from "lucide-react";
import { GlassCard } from "@/components/ui/glass-card";
import { MainLayout } from "@/components/layout/MainLayout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Label } from "@/components/ui/label";
import { useNotificationSound } from "@/hooks/useNotificationSound";
import { toast } from "@/hooks/use-toast";
import { conversationsService, tabulationsService, contactsService, Conversation as APIConversation, Tabulation } from "@/services/api";
import { useRealtimeConnection, useRealtimeSubscription } from "@/hooks/useRealtimeConnection";
import { WS_EVENTS, realtimeSocket } from "@/services/websocket";
import { format } from "date-fns";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { useAuth } from "@/contexts/AuthContext";

interface ConversationGroup {
  contactPhone: string;
  contactName: string;
  lastMessage: string;
  lastMessageTime: string;
  isFromContact: boolean;
  unread?: boolean;
  messages: APIConversation[];
}

export default function Atendimento() {
  const { user } = useAuth();
  const [selectedConversation, setSelectedConversation] = useState<ConversationGroup | null>(null);
  const [message, setMessage] = useState("");
  const [isNewConversationOpen, setIsNewConversationOpen] = useState(false);
  const [conversations, setConversations] = useState<ConversationGroup[]>([]);
  const [tabulations, setTabulations] = useState<Tabulation[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isSending, setIsSending] = useState(false);
  const [newContactName, setNewContactName] = useState("");
  const [newContactPhone, setNewContactPhone] = useState("");
  const [newContactCpf, setNewContactCpf] = useState("");
  const [newContactContract, setNewContactContract] = useState("");
  const [newContactMessage, setNewContactMessage] = useState("");
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const { playMessageSound, playSuccessSound, playErrorSound } = useNotificationSound();
  const { isConnected: isRealtimeConnected } = useRealtimeConnection();
  const previousConversationsRef = useRef<ConversationGroup[]>([]);

  // Subscribe to new messages in real-time
  useRealtimeSubscription(WS_EVENTS.NEW_MESSAGE, (data: any) => {
    console.log('[Atendimento] New message received:', data);
    
    if (data.message) {
      const newMsg = data.message as APIConversation;
      
      // Play sound for incoming messages
      if (newMsg.sender === 'contact') {
        playMessageSound();
      }
      
      setConversations(prev => {
        const existing = prev.find(c => c.contactPhone === newMsg.contactPhone);
        
        if (existing) {
          // Add message to existing conversation
          const updated = prev.map(conv => {
            if (conv.contactPhone === newMsg.contactPhone) {
              return {
                ...conv,
                messages: [...conv.messages, newMsg].sort((a, b) => 
                  new Date(a.datetime).getTime() - new Date(b.datetime).getTime()
                ),
                lastMessage: newMsg.message,
                lastMessageTime: newMsg.datetime,
                isFromContact: newMsg.sender === 'contact',
              };
            }
            return conv;
          });
          return updated.sort((a, b) => 
            new Date(b.lastMessageTime).getTime() - new Date(a.lastMessageTime).getTime()
          );
        } else {
          // Create new conversation group
          const newGroup: ConversationGroup = {
            contactPhone: newMsg.contactPhone,
            contactName: newMsg.contactName,
            lastMessage: newMsg.message,
            lastMessageTime: newMsg.datetime,
            isFromContact: newMsg.sender === 'contact',
            messages: [newMsg],
            unread: true,
          };
          return [newGroup, ...prev];
        }
      });

      // Update selected conversation if it's the same contact (usando ref)
      if (selectedPhoneRef.current === newMsg.contactPhone) {
        setSelectedConversation(prev => {
          if (!prev) return null;
          return {
            ...prev,
            messages: [...prev.messages, newMsg].sort((a, b) => 
              new Date(a.datetime).getTime() - new Date(b.datetime).getTime()
            ),
            lastMessage: newMsg.message,
            lastMessageTime: newMsg.datetime,
            isFromContact: newMsg.sender === 'contact',
          };
        });
      }
    }
  }, [playMessageSound]); // Removido selectedConversation da dependência

  // Subscribe to new conversations
  useRealtimeSubscription(WS_EVENTS.NEW_CONVERSATION, (data: any) => {
    console.log('[Atendimento] New conversation:', data);
    if (data.conversation) {
      playMessageSound();
      loadConversations();
    }
  }, []);

  // Subscribe to message sent confirmation
  useRealtimeSubscription('message-sent', (data: any) => {
    console.log('[Atendimento] Message sent confirmation:', data);
    if (data) {
      // Adicionar mensagem à conversa ativa
      const newMsg = data as APIConversation;
      
      setConversations(prev => {
        const existing = prev.find(c => c.contactPhone === newMsg.contactPhone);
        
        if (existing) {
          return prev.map(conv => {
            if (conv.contactPhone === newMsg.contactPhone) {
              return {
                ...conv,
                messages: [...conv.messages, newMsg].sort((a, b) => 
                  new Date(a.datetime).getTime() - new Date(b.datetime).getTime()
                ),
                lastMessage: newMsg.message,
                lastMessageTime: newMsg.datetime,
                isFromContact: false,
              };
            }
            return conv;
          }).sort((a, b) => 
            new Date(b.lastMessageTime).getTime() - new Date(a.lastMessageTime).getTime()
          );
        } else {
          // Nova conversa criada
          const newGroup: ConversationGroup = {
            contactPhone: newMsg.contactPhone,
            contactName: newMsg.contactName,
            lastMessage: newMsg.message,
            lastMessageTime: newMsg.datetime,
            isFromContact: false,
            messages: [newMsg],
          };
          return [newGroup, ...prev];
        }
      });

      // Atualizar conversa selecionada se for a mesma (usando ref)
      if (selectedPhoneRef.current === newMsg.contactPhone) {
        setSelectedConversation(prev => {
          if (!prev) return null;
          return {
            ...prev,
            messages: [...prev.messages, newMsg].sort((a, b) => 
              new Date(a.datetime).getTime() - new Date(b.datetime).getTime()
            ),
            lastMessage: newMsg.message,
            lastMessageTime: newMsg.datetime,
          };
        });
      }
    }
  }, []); // Sem dependências - usa ref

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  // Ref para armazenar o contactPhone selecionado (evita loop infinito)
  const selectedPhoneRef = useRef<string | null>(null);

  // Atualizar ref quando selectedConversation mudar
  useEffect(() => {
    selectedPhoneRef.current = selectedConversation?.contactPhone || null;
  }, [selectedConversation?.contactPhone]);

  const loadConversations = useCallback(async () => {
    try {
      const data = await conversationsService.getActive();
      
      // Group conversations by contact phone
      const groupedMap = new Map<string, ConversationGroup>();
      
      data.forEach((conv) => {
        const existing = groupedMap.get(conv.contactPhone);
        if (existing) {
          existing.messages.push(conv);
          // Update last message if this one is more recent
          const convTime = new Date(conv.datetime).getTime();
          const existingTime = new Date(existing.lastMessageTime).getTime();
          if (convTime > existingTime) {
            existing.lastMessage = conv.message;
            existing.lastMessageTime = conv.datetime;
            existing.isFromContact = conv.sender === 'contact';
          }
        } else {
          groupedMap.set(conv.contactPhone, {
            contactPhone: conv.contactPhone,
            contactName: conv.contactName,
            lastMessage: conv.message,
            lastMessageTime: conv.datetime,
            isFromContact: conv.sender === 'contact',
            messages: [conv],
          });
        }
      });

      // Sort messages within each group and groups by last message time
      const groups = Array.from(groupedMap.values()).map(group => ({
        ...group,
        messages: group.messages.sort((a, b) => 
          new Date(a.datetime).getTime() - new Date(b.datetime).getTime()
        ),
      })).sort((a, b) => 
        new Date(b.lastMessageTime).getTime() - new Date(a.lastMessageTime).getTime()
      );

      setConversations(groups);
      
      // Update selected conversation if it exists (usando ref para evitar loop)
      const currentSelectedPhone = selectedPhoneRef.current;
      if (currentSelectedPhone) {
        const updated = groups.find(g => g.contactPhone === currentSelectedPhone);
        if (updated) {
          setSelectedConversation(updated);
        }
      }
    } catch (error) {
      console.error('Error loading conversations:', error);
    } finally {
      setIsLoading(false);
    }
  }, []); // Sem dependências - usa ref em vez de state

  const loadTabulations = useCallback(async () => {
    try {
      const data = await tabulationsService.list();
      setTabulations(data);
    } catch (error) {
      console.error('Error loading tabulations:', error);
    }
  }, []);

  useEffect(() => {
    loadConversations();
    loadTabulations();
  }, [loadConversations, loadTabulations]);

  // Poll for new messages only if WebSocket not connected
  useEffect(() => {
    if (isRealtimeConnected) {
      console.log('[Atendimento] WebSocket connected, polling disabled');
      return;
    }

    console.log('[Atendimento] WebSocket not connected, using polling fallback');
    const interval = setInterval(() => {
      loadConversations();
    }, 5000);

    return () => clearInterval(interval);
  }, [loadConversations, isRealtimeConnected]);

  useEffect(() => {
    scrollToBottom();
  }, [selectedConversation?.messages]);

  const handleSendMessage = useCallback(async () => {
    if (!message.trim() || !selectedConversation || isSending) return;

    setIsSending(true);
    const messageText = message.trim();
    setMessage(""); // Limpar input imediatamente para UX

    try {
      // Usar WebSocket para enviar mensagem via WhatsApp (se conectado)
      if (isRealtimeConnected) {
        console.log('[Atendimento] Enviando mensagem via WebSocket...');
        realtimeSocket.send('send-message', {
          contactPhone: selectedConversation.contactPhone,
          message: messageText,
          messageType: 'text',
        });
        
        // A resposta virá via evento 'message-sent' ou 'new-message'
        playSuccessSound();
        toast({
          title: "Mensagem enviada",
          description: "Sua mensagem foi enviada com sucesso",
        });
      } else {
        // Fallback: Usar REST API (apenas salva no banco, não envia via WhatsApp)
        console.log('[Atendimento] WebSocket não conectado, salvando via REST...');
        await conversationsService.create({
          contactName: selectedConversation.contactName,
          contactPhone: selectedConversation.contactPhone,
          message: messageText,
          sender: 'operator',
          messageType: 'text',
          userName: user?.name,
          userLine: user?.lineId,
          segment: user?.segmentId,
        });

        playSuccessSound();
        toast({
          title: "Mensagem salva",
          description: "Mensagem salva (WebSocket desconectado)",
          variant: "default",
        });
        
        await loadConversations();
      }
    } catch (error) {
      setMessage(messageText); // Restaurar mensagem se falhou
      playErrorSound();
      toast({
        title: "Erro ao enviar",
        description: error instanceof Error ? error.message : "Erro ao enviar mensagem",
        variant: "destructive",
      });
    } finally {
      setIsSending(false);
    }
  }, [message, selectedConversation, isSending, user, isRealtimeConnected, playSuccessSound, playErrorSound, loadConversations]);

  const handleTabulate = useCallback(async (tabulationId: number) => {
    if (!selectedConversation) return;

    try {
      await conversationsService.tabulate(selectedConversation.contactPhone, tabulationId);
      playSuccessSound();
      toast({
        title: "Conversa tabulada",
        description: "A conversa foi tabulada com sucesso",
      });
      
      // Remove from active conversations
      setConversations(prev => prev.filter(c => c.contactPhone !== selectedConversation.contactPhone));
      setSelectedConversation(null);
    } catch (error) {
      playErrorSound();
      toast({
        title: "Erro ao tabular",
        description: error instanceof Error ? error.message : "Erro ao tabular conversa",
        variant: "destructive",
      });
    }
  }, [selectedConversation, playSuccessSound, playErrorSound]);

  const handleNewConversation = useCallback(async () => {
    if (!newContactName.trim() || !newContactPhone.trim()) {
      toast({
        title: "Campos obrigatórios",
        description: "Nome e telefone são obrigatórios",
        variant: "destructive",
      });
      return;
    }

    if (!newContactMessage.trim()) {
      toast({
        title: "Mensagem obrigatória",
        description: "Digite a mensagem que deseja enviar",
        variant: "destructive",
      });
      return;
    }

    if (!user?.lineId) {
      toast({
        title: "Linha não atribuída",
        description: "Você precisa ter uma linha atribuída para iniciar conversas",
        variant: "destructive",
      });
      return;
    }

    try {
      // Primeiro, criar ou atualizar o contato
      try {
        await contactsService.create({
          name: newContactName.trim(),
          phone: newContactPhone.trim(),
          cpf: newContactCpf.trim() || undefined,
          contract: newContactContract.trim() || undefined,
          segment: user.segmentId,
        });
      } catch {
        // Contato pode já existir, ignorar erro
      }

      // Usar WebSocket para enviar a mensagem escrita pelo operador
      if (isRealtimeConnected) {
        console.log('[Atendimento] Criando nova conversa via WebSocket...');
        realtimeSocket.send('send-message', {
          contactPhone: newContactPhone.trim(),
          message: newContactMessage.trim(),
          messageType: 'text',
        });

        playSuccessSound();
        toast({
          title: "Conversa iniciada",
          description: "Mensagem enviada via WhatsApp",
        });
      } else {
        // Fallback: Apenas salvar no banco
        await conversationsService.create({
          contactName: newContactName.trim(),
          contactPhone: newContactPhone.trim(),
          message: `Olá ${newContactName.trim()}, tudo bem?`,
          sender: 'operator',
          messageType: 'text',
          userName: user.name,
          userLine: user.lineId,
          segment: user.segmentId,
        });

        playSuccessSound();
        toast({
          title: "Conversa salva",
          description: "Salvo no sistema (WhatsApp não enviado - offline)",
          variant: "default",
        });
        
        await loadConversations();
      }
      
      setIsNewConversationOpen(false);
      setNewContactName("");
      setNewContactPhone("");
      setNewContactCpf("");
      setNewContactContract("");
      setNewContactMessage("");
    } catch (error) {
      playErrorSound();
      toast({
        title: "Erro ao criar conversa",
        description: error instanceof Error ? error.message : "Erro ao criar conversa",
        variant: "destructive",
      });
    }
  }, [newContactName, newContactPhone, newContactCpf, newContactContract, newContactMessage, user, isRealtimeConnected, playSuccessSound, playErrorSound, loadConversations]);

  const formatTime = (datetime: string) => {
    try {
      return format(new Date(datetime), 'HH:mm');
    } catch {
      return '';
    }
  };

  return (
    <MainLayout>
      <div className="h-[calc(100vh-6rem)] flex gap-4">
        {/* Conversations List */}
        <GlassCard className="w-80 flex flex-col" padding="none">
          {/* Header */}
          <div className="p-4 border-b border-border/50 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <h2 className="font-semibold text-foreground">Atendimentos</h2>
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <div className={`flex items-center gap-1 px-2 py-0.5 rounded-full text-xs ${
                      isRealtimeConnected 
                        ? 'bg-success/10 text-success' 
                        : 'bg-muted text-muted-foreground'
                    }`}>
                      {isRealtimeConnected ? (
                        <Wifi className="h-3 w-3" />
                      ) : (
                        <WifiOff className="h-3 w-3" />
                      )}
                    </div>
                  </TooltipTrigger>
                  <TooltipContent>
                    {isRealtimeConnected 
                      ? 'Conectado em tempo real' 
                      : 'Reconectando...'}
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
            </div>
            <Dialog open={isNewConversationOpen} onOpenChange={setIsNewConversationOpen}>
              <DialogTrigger asChild>
                <Button size="icon" className="h-8 w-8">
                  <Plus className="h-4 w-4" />
                </Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>Nova Conversa</DialogTitle>
                  <DialogDescription>
                    Inicie uma nova conversa com um contato
                  </DialogDescription>
                </DialogHeader>
                <div className="space-y-4 py-4">
                  <div className="space-y-2">
                    <Label htmlFor="name">Nome *</Label>
                    <Input 
                      id="name" 
                      placeholder="Nome do contato"
                      value={newContactName}
                      onChange={(e) => setNewContactName(e.target.value)}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="phone">Telefone *</Label>
                    <Input 
                      id="phone" 
                      placeholder="+55 11 99999-9999"
                      value={newContactPhone}
                      onChange={(e) => setNewContactPhone(e.target.value)}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="cpf">CPF</Label>
                    <Input 
                      id="cpf" 
                      placeholder="000.000.000-00"
                      value={newContactCpf}
                      onChange={(e) => setNewContactCpf(e.target.value)}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="contract">Contrato</Label>
                    <Input 
                      id="contract" 
                      placeholder="Número do contrato"
                      value={newContactContract}
                      onChange={(e) => setNewContactContract(e.target.value)}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="message">Mensagem *</Label>
                    <Input 
                      id="message" 
                      placeholder="Digite a mensagem que deseja enviar..."
                      value={newContactMessage}
                      onChange={(e) => setNewContactMessage(e.target.value)}
                    />
                  </div>
                </div>
                <DialogFooter>
                  <Button variant="outline" onClick={() => setIsNewConversationOpen(false)}>
                    Cancelar
                  </Button>
                  <Button onClick={handleNewConversation} disabled={!newContactMessage.trim()}>
                    Enviar Mensagem
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          </div>

          {/* Conversations */}
          <ScrollArea className="flex-1">
            {isLoading ? (
              <div className="flex items-center justify-center h-48">
                <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
              </div>
            ) : conversations.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-48 text-muted-foreground">
                <MessageCircle className="h-12 w-12 mb-2 opacity-50" />
                <p className="text-sm">Nenhuma conversa ativa</p>
              </div>
            ) : (
              <div className="p-2 space-y-1">
                {conversations.map((conv) => (
                  <button
                    key={conv.contactPhone}
                    onClick={() => setSelectedConversation(conv)}
                    className={cn(
                      "w-full p-3 rounded-xl text-left transition-colors",
                      "hover:bg-primary/5",
                      selectedConversation?.contactPhone === conv.contactPhone && "bg-primary/10"
                    )}
                  >
                    <div className="flex items-start gap-3">
                      <div className="w-10 h-10 rounded-full bg-gradient-to-br from-primary to-cyan flex items-center justify-center flex-shrink-0">
                        <span className="text-sm font-medium text-primary-foreground">
                          {conv.contactName.split(' ').map(n => n[0]).join('').slice(0, 2)}
                        </span>
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center justify-between">
                          <p className="font-medium text-sm text-foreground truncate">
                            {conv.contactName}
                          </p>
                          <span className="text-xs text-muted-foreground">
                            {formatTime(conv.lastMessageTime)}
                          </span>
                        </div>
                        <div className="flex items-center gap-1 mt-0.5">
                          {conv.isFromContact ? (
                            <ArrowLeft className="h-3 w-3 text-muted-foreground" />
                          ) : (
                            <ArrowRight className="h-3 w-3 text-primary" />
                          )}
                          <p className="text-xs text-muted-foreground truncate">
                            {conv.lastMessage}
                          </p>
                        </div>
                      </div>
                      {conv.unread && (
                        <div className="w-2 h-2 rounded-full bg-primary flex-shrink-0 mt-2" />
                      )}
                    </div>
                  </button>
                ))}
              </div>
            )}
          </ScrollArea>
        </GlassCard>

        {/* Chat Area */}
        <GlassCard className="flex-1 flex flex-col" padding="none">
          {selectedConversation ? (
            <>
              {/* Chat Header */}
              <div className="p-4 border-b border-border/50 flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-full bg-gradient-to-br from-primary to-cyan flex items-center justify-center">
                    <span className="text-sm font-medium text-primary-foreground">
                      {selectedConversation.contactName.split(' ').map(n => n[0]).join('').slice(0, 2)}
                    </span>
                  </div>
                  <div>
                    <p className="font-medium text-foreground">{selectedConversation.contactName}</p>
                    <p className="text-xs text-muted-foreground">{selectedConversation.contactPhone}</p>
                  </div>
                </div>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="outline" size="sm">
                      Tabular
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    {tabulations.map((tab) => (
                      <DropdownMenuItem key={tab.id} onClick={() => handleTabulate(tab.id)}>
                        {tab.name}
                      </DropdownMenuItem>
                    ))}
                    {tabulations.length === 0 && (
                      <DropdownMenuItem disabled>Nenhuma tabulação disponível</DropdownMenuItem>
                    )}
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>

              {/* Messages */}
              <ScrollArea className="flex-1 p-4">
                <div className="space-y-4">
                  {selectedConversation.messages.map((msg) => (
                    <div
                      key={msg.id}
                      className={cn(
                        "flex gap-2",
                        msg.sender === 'contact' ? "justify-start" : "justify-end"
                      )}
                    >
                      {msg.sender === 'contact' && (
                        <div className="w-8 h-8 rounded-full bg-muted flex items-center justify-center flex-shrink-0">
                          <span className="text-xs font-medium">
                            {selectedConversation.contactName.split(' ').map(n => n[0]).join('').slice(0, 2)}
                          </span>
                        </div>
                      )}
                      <div
                        className={cn(
                          "max-w-[70%] rounded-2xl px-4 py-2",
                          msg.sender === 'contact'
                            ? "bg-card border border-border"
                            : "bg-primary text-primary-foreground"
                        )}
                      >
                        <p className="text-sm">{msg.message}</p>
                        <p className={cn(
                          "text-xs mt-1",
                          msg.sender === 'contact' ? "text-muted-foreground" : "text-primary-foreground/70"
                        )}>
                          {formatTime(msg.datetime)}
                        </p>
                      </div>
                      {msg.sender === 'operator' && (
                        <div className="w-8 h-8 rounded-full bg-gradient-to-br from-primary to-cyan flex items-center justify-center flex-shrink-0">
                          <span className="text-xs font-medium text-primary-foreground">OP</span>
                        </div>
                      )}
                    </div>
                  ))}
                  <div ref={messagesEndRef} />
                </div>
              </ScrollArea>

              {/* Message Input */}
              <div className="p-4 border-t border-border/50">
                <div className="flex gap-2">
                  <Button variant="outline" size="icon">
                    <FileText className="h-4 w-4" />
                  </Button>
                  <Input
                    placeholder="Digite sua mensagem..."
                    value={message}
                    onChange={(e) => setMessage(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && !e.shiftKey && handleSendMessage()}
                    className="flex-1"
                    disabled={isSending}
                  />
                  <Button size="icon" onClick={handleSendMessage} disabled={isSending}>
                    {isSending ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <Send className="h-4 w-4" />
                    )}
                  </Button>
                </div>
              </div>
            </>
          ) : (
            <div className="flex-1 flex flex-col items-center justify-center text-muted-foreground">
              <MessageCircle className="h-16 w-16 mb-4 opacity-50" />
              <p className="text-lg font-medium">Selecione uma conversa</p>
              <p className="text-sm">Escolha uma conversa para começar o atendimento</p>
            </div>
          )}
        </GlassCard>
      </div>
    </MainLayout>
  );
}
