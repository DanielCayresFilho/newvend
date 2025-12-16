import { useState, useEffect, useCallback, useRef } from "react";
import { Plus, Send, FileText, MessageCircle, ArrowRight, ArrowLeft, Loader2, Wifi, WifiOff, Edit, UserCheck, X, Check, Phone, AlertTriangle } from "lucide-react";
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
import { Switch } from "@/components/ui/switch";
import { useNotificationSound } from "@/hooks/useNotificationSound";
import { toast } from "@/hooks/use-toast";
import { conversationsService, tabulationsService, contactsService, Contact, Conversation as APIConversation, Tabulation, getAuthToken } from "@/services/api";
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
  
  // Estado para edição de contato
  const [isEditContactOpen, setIsEditContactOpen] = useState(false);
  const [editingContact, setEditingContact] = useState<Contact | null>(null);
  const [editContactName, setEditContactName] = useState("");
  const [editContactCpf, setEditContactCpf] = useState("");
  const [editContactContract, setEditContactContract] = useState("");
  const [editContactIsCPC, setEditContactIsCPC] = useState(false);
  const [isSavingContact, setIsSavingContact] = useState(false);
  const previousConversationsRef = useRef<ConversationGroup[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isUploadingFile, setIsUploadingFile] = useState(false);
  
  // Estado para notificação de linha banida
  const [lineBannedNotification, setLineBannedNotification] = useState<{
    bannedLinePhone: string;
    newLinePhone: string | null;
    contactsToRecall: Array<{ phone: string; name: string }>;
    message: string;
  } | null>(null);
  const [isRecallingContact, setIsRecallingContact] = useState<string | null>(null);

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
    if (data?.message) {
      // Adicionar mensagem à conversa ativa
      const newMsg = data.message as APIConversation;
      
      // Mostrar toast de sucesso
      playSuccessSound();
      toast({
        title: "Mensagem enviada",
        description: "Sua mensagem foi enviada com sucesso",
      });
      
      // Se estava criando nova conversa, fechar dialog e limpar campos
      if (isNewConversationOpen) {
        setIsNewConversationOpen(false);
        setNewContactName("");
        setNewContactPhone("");
        setNewContactCpf("");
        setNewContactContract("");
        setNewContactMessage("");
      }
      
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
  }, [playSuccessSound, isNewConversationOpen]); // Adicionar dependências

  // Subscribe to message errors (bloqueios CPC, repescagem, etc)
  useRealtimeSubscription('message-error', (data: any) => {
    console.log('[Atendimento] Message error received:', data);
    if (data?.error) {
      playErrorSound();
      
      // Determinar título baseado no tipo de erro
      let title = "Mensagem bloqueada";
      if (data.error.includes('CPC')) {
        title = "Bloqueio de CPC";
      } else if (data.error.includes('repescagem') || data.error.includes('Aguarde')) {
        title = "Bloqueio de Repescagem";
      } else if (data.error.includes('permissão')) {
        title = "Sem permissão";
      }
      
      toast({
        title,
        description: data.error,
        variant: "destructive",
        duration: data.hoursRemaining ? 8000 : 5000, // Mostrar por mais tempo se tiver horas restantes
      });
    }
  }, [playErrorSound]);

  // Subscribe to line-banned event
  useRealtimeSubscription(WS_EVENTS.LINE_BANNED, (data: any) => {
    console.log('[Atendimento] Line banned notification received:', data);
    playErrorSound();
    
    setLineBannedNotification({
      bannedLinePhone: data.bannedLinePhone || 'N/A',
      newLinePhone: data.newLinePhone || null,
      contactsToRecall: data.contactsToRecall || [],
      message: data.message || 'Sua linha foi banida.',
    });
    
    toast({
      title: "⚠️ Linha Banida",
      description: data.message || 'Sua linha foi banida. Verifique os contatos para rechamar.',
      variant: "destructive",
      duration: 10000,
    });
  }, [playErrorSound]);

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

  // Carregar dados do contato para edição
  const openEditContact = useCallback(async () => {
    if (!selectedConversation) return;
    
    try {
      const contact = await contactsService.getByPhone(selectedConversation.contactPhone);
      if (contact) {
        setEditingContact(contact);
        setEditContactName(contact.name);
        setEditContactCpf(contact.cpf || "");
        setEditContactContract(contact.contract || "");
        setEditContactIsCPC(contact.isCPC || false);
        setIsEditContactOpen(true);
      } else {
        // Contato não existe, criar com dados básicos
        setEditingContact(null);
        setEditContactName(selectedConversation.contactName);
        setEditContactCpf("");
        setEditContactContract("");
        setEditContactIsCPC(false);
        setIsEditContactOpen(true);
      }
    } catch (error) {
      console.error('Error loading contact:', error);
      toast({
        title: "Erro",
        description: "Não foi possível carregar os dados do contato",
        variant: "destructive",
      });
    }
  }, [selectedConversation]);

  // Salvar alterações do contato
  const handleSaveContact = useCallback(async () => {
    if (!selectedConversation) return;
    
    setIsSavingContact(true);
    try {
      const updateData = {
        name: editContactName.trim(),
        cpf: editContactCpf.trim() || undefined,
        contract: editContactContract.trim() || undefined,
        isCPC: editContactIsCPC,
      };

      if (editingContact) {
        await contactsService.updateByPhone(selectedConversation.contactPhone, updateData);
      } else {
        // Criar contato se não existir
        await contactsService.create({
          name: editContactName.trim(),
          phone: selectedConversation.contactPhone,
          cpf: editContactCpf.trim() || undefined,
          contract: editContactContract.trim() || undefined,
          isCPC: editContactIsCPC,
          segment: user?.segmentId,
        });
      }

      // Atualizar nome na conversa selecionada
      if (editContactName.trim() !== selectedConversation.contactName) {
        setSelectedConversation(prev => prev ? {
          ...prev,
          contactName: editContactName.trim(),
        } : null);

        // Atualizar na lista de conversas
        setConversations(prev => prev.map(c => 
          c.contactPhone === selectedConversation.contactPhone 
            ? { ...c, contactName: editContactName.trim() }
            : c
        ));
      }

      playSuccessSound();
      toast({
        title: "Contato atualizado",
        description: editContactIsCPC ? "Contato marcado como CPC" : "Dados salvos com sucesso",
      });
      setIsEditContactOpen(false);
    } catch (error) {
      playErrorSound();
      toast({
        title: "Erro ao salvar",
        description: error instanceof Error ? error.message : "Erro ao salvar contato",
        variant: "destructive",
      });
    } finally {
      setIsSavingContact(false);
    }
  }, [selectedConversation, editingContact, editContactName, editContactCpf, editContactContract, editContactIsCPC, user, playSuccessSound, playErrorSound]);

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

  // Função para determinar o tipo de mídia baseado no mimetype
  const getMessageTypeFromMime = (mimeType: string): 'image' | 'video' | 'audio' | 'document' => {
    if (mimeType.startsWith('image/')) return 'image';
    if (mimeType.startsWith('video/')) return 'video';
    if (mimeType.startsWith('audio/')) return 'audio';
    return 'document';
  };

  // Função para fazer upload de arquivo
  const handleFileUpload = useCallback(async (file: File) => {
    if (!selectedConversation || isUploadingFile) return;

    setIsUploadingFile(true);
    try {
      const formData = new FormData();
      formData.append('file', file);

      const token = getAuthToken();
      if (!token) {
        throw new Error('Não autenticado');
      }

      const response = await fetch('https://api.newvend.taticamarketing.com.br/media/upload', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
        },
        body: formData,
      });

      if (!response.ok) {
        throw new Error('Erro ao fazer upload do arquivo');
      }

      const data = await response.json();
      const messageType = getMessageTypeFromMime(data.mimeType);
      const mediaUrl = data.mediaUrl.startsWith('http') ? data.mediaUrl : `https://api.newvend.taticamarketing.com.br${data.mediaUrl}`;

      // Enviar mensagem com mídia via WebSocket
      if (isRealtimeConnected) {
        realtimeSocket.send('send-message', {
          contactPhone: selectedConversation.contactPhone,
          message: message.trim() || (messageType === 'image' ? 'Imagem enviada' : messageType === 'video' ? 'Vídeo enviado' : messageType === 'audio' ? 'Áudio enviado' : 'Documento enviado'),
          messageType,
          mediaUrl,
          fileName: data.originalName || data.fileName, // Incluir nome do arquivo para documentos
        });
      } else {
        // Fallback: salvar via REST API
        await conversationsService.create({
          contactName: selectedConversation.contactName,
          contactPhone: selectedConversation.contactPhone,
          message: message.trim() || (messageType === 'image' ? 'Imagem enviada' : messageType === 'video' ? 'Vídeo enviado' : messageType === 'audio' ? 'Áudio enviado' : 'Documento enviado'),
          sender: 'operator',
          messageType,
          mediaUrl,
          userName: user?.name,
          userLine: user?.lineId,
          segment: user?.segmentId,
        });
      }

      setMessage(""); // Limpar input
      toast({
        title: "Arquivo enviado",
        description: "Arquivo enviado com sucesso",
      });
    } catch (error) {
      console.error('Erro ao fazer upload:', error);
      playErrorSound();
      toast({
        title: "Erro ao enviar arquivo",
        description: error instanceof Error ? error.message : "Erro desconhecido",
        variant: "destructive",
      });
    } finally {
      setIsUploadingFile(false);
      // Limpar input de arquivo
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    }
  }, [selectedConversation, isUploadingFile, isRealtimeConnected, message, user, playErrorSound]);

  // Handler para seleção de arquivo
  const handleFileSelect = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      handleFileUpload(file);
    }
  }, [handleFileUpload]);

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
        
        // A resposta virá via evento 'message-sent' (sucesso) ou 'message-error' (erro)
        // Não mostrar sucesso imediatamente - aguardar confirmação
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
          isNewConversation: true, // Indica que é 1x1 para verificar permissão
        });

        // Não mostrar sucesso imediatamente - aguardar confirmação ou erro
        // O sucesso será mostrado quando receber 'message-sent' (e o dialog será fechado)
        // O erro será mostrado quando receber 'message-error' (dialog permanece aberto)
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
      
        // Fechar dialog apenas se não estiver usando WebSocket
      setIsNewConversationOpen(false);
      setNewContactName("");
      setNewContactPhone("");
      setNewContactCpf("");
      setNewContactContract("");
      setNewContactMessage("");
      }
      // Se usar WebSocket, o dialog será fechado quando receber 'message-sent'
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
                  <TooltipProvider>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button variant="ghost" size="icon" className="h-8 w-8" onClick={openEditContact}>
                          <Edit className="h-4 w-4" />
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent>Editar Contato</TooltipContent>
                    </Tooltip>
                  </TooltipProvider>
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

              {/* Modal de Edição de Contato */}
              <Dialog open={isEditContactOpen} onOpenChange={setIsEditContactOpen}>
                <DialogContent>
                  <DialogHeader>
                    <DialogTitle>Editar Contato</DialogTitle>
                    <DialogDescription>
                      Edite as informações do contato
                    </DialogDescription>
                  </DialogHeader>
                  <div className="space-y-4 py-4">
                    <div className="space-y-2">
                      <Label htmlFor="edit-name">Nome</Label>
                      <Input
                        id="edit-name"
                        placeholder="Nome do contato"
                        value={editContactName}
                        onChange={(e) => setEditContactName(e.target.value)}
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="edit-cpf">CPF</Label>
                      <Input
                        id="edit-cpf"
                        placeholder="000.000.000-00"
                        value={editContactCpf}
                        onChange={(e) => setEditContactCpf(e.target.value)}
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="edit-contract">Contrato</Label>
                      <Input
                        id="edit-contract"
                        placeholder="Número do contrato"
                        value={editContactContract}
                        onChange={(e) => setEditContactContract(e.target.value)}
                      />
                    </div>
                    <div className="flex items-center justify-between rounded-lg border p-4">
                      <div className="space-y-0.5">
                        <Label className="text-base font-medium">Marcar como CPC</Label>
                        <p className="text-sm text-muted-foreground">
                          Contato foi contatado com sucesso
                        </p>
                      </div>
                      <Switch
                        checked={editContactIsCPC}
                        onCheckedChange={setEditContactIsCPC}
                      />
                    </div>
                  </div>
                  <DialogFooter>
                    <Button variant="outline" onClick={() => setIsEditContactOpen(false)}>
                      Cancelar
                    </Button>
                    <Button onClick={handleSaveContact} disabled={isSavingContact}>
                      {isSavingContact ? (
                        <>
                          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                          Salvando...
                        </>
                      ) : (
                        <>
                          <Check className="mr-2 h-4 w-4" />
                          Salvar
                        </>
                      )}
                    </Button>
                  </DialogFooter>
                </DialogContent>
              </Dialog>

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
                        {/* Renderizar mídia baseado no messageType */}
                        {msg.messageType === 'image' && msg.mediaUrl ? (
                          <div className="mb-2">
                            <img 
                              src={msg.mediaUrl.startsWith('http') ? msg.mediaUrl : `https://api.newvend.taticamarketing.com.br${msg.mediaUrl}`}
                              alt="Imagem"
                              className="max-w-full rounded-lg cursor-pointer hover:opacity-90 transition-opacity"
                              style={{ maxHeight: '300px' }}
                              onClick={() => window.open(msg.mediaUrl!.startsWith('http') ? msg.mediaUrl! : `https://api.newvend.taticamarketing.com.br${msg.mediaUrl}`, '_blank')}
                            />
                            {msg.message && !msg.message.includes('recebida') && (
                              <p className="text-sm mt-2">{msg.message}</p>
                            )}
                          </div>
                        ) : msg.messageType === 'audio' && msg.mediaUrl ? (
                          <div className="mb-2">
                            <audio 
                              controls 
                              className="max-w-full"
                              src={msg.mediaUrl.startsWith('http') ? msg.mediaUrl : `https://api.newvend.taticamarketing.com.br${msg.mediaUrl}`}
                            >
                              Seu navegador não suporta áudio.
                            </audio>
                          </div>
                        ) : msg.messageType === 'video' && msg.mediaUrl ? (
                          <div className="mb-2">
                            <video 
                              controls 
                              className="max-w-full rounded-lg"
                              style={{ maxHeight: '300px' }}
                              src={msg.mediaUrl.startsWith('http') ? msg.mediaUrl : `https://api.newvend.taticamarketing.com.br${msg.mediaUrl}`}
                            >
                              Seu navegador não suporta vídeo.
                            </video>
                            {msg.message && !msg.message.includes('recebido') && (
                              <p className="text-sm mt-2">{msg.message}</p>
                            )}
                          </div>
                        ) : msg.messageType === 'document' && msg.mediaUrl ? (
                          <div className="mb-2">
                            <a 
                              href={msg.mediaUrl.startsWith('http') ? msg.mediaUrl : `https://api.newvend.taticamarketing.com.br${msg.mediaUrl}`}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="flex items-center gap-2 text-sm underline hover:no-underline"
                            >
                              <FileText className="h-4 w-4" />
                              {msg.message || 'Documento'}
                            </a>
                          </div>
                        ) : (
                          <p className="text-sm">{msg.message}</p>
                        )}
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
                  <input
                    type="file"
                    ref={fileInputRef}
                    onChange={handleFileSelect}
                    accept="image/*,video/*,audio/*,.pdf,.doc,.docx,.xls,.xlsx"
                    className="hidden"
                    id="file-upload-input"
                    disabled={isUploadingFile || !selectedConversation}
                  />
                  <Button
                    variant="outline"
                    size="icon"
                    onClick={() => fileInputRef.current?.click()}
                    disabled={isUploadingFile || !selectedConversation}
                    title="Enviar arquivo"
                  >
                    {isUploadingFile ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <FileText className="h-4 w-4" />
                    )}
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

      {/* Dialog de Notificação de Linha Banida */}
      <Dialog open={!!lineBannedNotification} onOpenChange={(open) => !open && setLineBannedNotification(null)}>
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-destructive">
              <AlertTriangle className="h-5 w-5" />
              Linha Banida
            </DialogTitle>
            <DialogDescription>
              {lineBannedNotification?.message}
            </DialogDescription>
          </DialogHeader>
          
          <div className="space-y-4 py-4">
            <div className="p-4 bg-muted rounded-lg">
              <p className="text-sm font-medium mb-1">Linha banida:</p>
              <p className="text-sm text-muted-foreground">{lineBannedNotification?.bannedLinePhone}</p>
              {lineBannedNotification?.newLinePhone && (
                <>
                  <p className="text-sm font-medium mt-3 mb-1">Nova linha atribuída:</p>
                  <p className="text-sm text-success">{lineBannedNotification.newLinePhone}</p>
                </>
              )}
            </div>

            {lineBannedNotification && lineBannedNotification.contactsToRecall.length > 0 && (
              <div>
                <p className="text-sm font-medium mb-3">
                  Contatos para rechamar ({lineBannedNotification.contactsToRecall.length}):
                </p>
                <ScrollArea className="h-[300px] pr-4">
                  <div className="space-y-2">
                    {lineBannedNotification.contactsToRecall.map((contact) => (
                      <div
                        key={contact.phone}
                        className="flex items-center justify-between p-3 border rounded-lg hover:bg-muted/50 transition-colors"
                      >
                        <div className="flex-1">
                          <p className="text-sm font-medium">{contact.name}</p>
                          <p className="text-xs text-muted-foreground">{contact.phone}</p>
                        </div>
                        <Button
                          size="sm"
                          onClick={async () => {
                            if (isRecallingContact === contact.phone) return;
                            
                            setIsRecallingContact(contact.phone);
                            try {
                              await conversationsService.recallContact(contact.phone);
                              toast({
                                title: "✅ Contato rechamado",
                                description: `Conversa reiniciada com ${contact.name}`,
                              });
                              
                              // Recarregar conversas
                              await loadConversations();
                              
                              // Selecionar a conversa recém-criada
                              const updatedConversations = await conversationsService.getActive();
                              const newConv = updatedConversations.find(c => c.contactPhone === contact.phone);
                              if (newConv) {
                                const grouped = await loadConversations();
                                const found = grouped.find(c => c.contactPhone === contact.phone);
                                if (found) {
                                  setSelectedConversation(found);
                                }
                              }
                              
                              // Remover da lista de contatos para rechamar
                              setLineBannedNotification(prev => {
                                if (!prev) return null;
                                const updated = prev.contactsToRecall.filter(c => c.phone !== contact.phone);
                                if (updated.length === 0) {
                                  return null; // Fechar dialog se não houver mais contatos
                                }
                                return { ...prev, contactsToRecall: updated };
                              });
                            } catch (error) {
                              toast({
                                title: "Erro ao rechamar contato",
                                description: error instanceof Error ? error.message : "Erro desconhecido",
                                variant: "destructive",
                              });
                            } finally {
                              setIsRecallingContact(null);
                            }
                          }}
                          disabled={isRecallingContact === contact.phone || !!isRecallingContact}
                        >
                          {isRecallingContact === contact.phone ? (
                            <>
                              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                              Rechamando...
                            </>
                          ) : (
                            <>
                              <Phone className="mr-2 h-4 w-4" />
                              Rechamar
                            </>
                          )}
                        </Button>
                      </div>
                    ))}
                  </div>
                </ScrollArea>
              </div>
            )}

            {lineBannedNotification && lineBannedNotification.contactsToRecall.length === 0 && (
              <p className="text-sm text-muted-foreground text-center py-4">
                Nenhum contato para rechamar.
              </p>
            )}
          </div>

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setLineBannedNotification(null)}
            >
              Fechar
            </Button>
            {lineBannedNotification && lineBannedNotification.contactsToRecall.length > 0 && (
              <Button
                onClick={async () => {
                  // Rechamar todos os contatos
                  if (!lineBannedNotification) return;
                  
                  const contacts = [...lineBannedNotification.contactsToRecall];
                  for (const contact of contacts) {
                    try {
                      setIsRecallingContact(contact.phone);
                      await conversationsService.recallContact(contact.phone);
                      await new Promise(resolve => setTimeout(resolve, 500)); // Pequeno delay entre chamadas
                    } catch (error) {
                      console.error(`Erro ao rechamar ${contact.phone}:`, error);
                    } finally {
                      setIsRecallingContact(null);
                    }
                  }
                  
                  toast({
                    title: "✅ Contatos rechamados",
                    description: `${contacts.length} contato(s) rechamado(s) com sucesso`,
                  });
                  
                  await loadConversations();
                  setLineBannedNotification(null);
                }}
                disabled={!!isRecallingContact}
              >
                {isRecallingContact ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Rechamando todos...
                  </>
                ) : (
                  <>
                    <Phone className="mr-2 h-4 w-4" />
                    Rechamar Todos
                  </>
                )}
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </MainLayout>
  );
}
