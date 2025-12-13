import { useState, useEffect } from "react";
import { MainLayout } from "@/components/layout/MainLayout";
import { CrudTable, Column } from "@/components/crud/CrudTable";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { DialogFooter } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { toast } from "@/hooks/use-toast";
import { usersService, segmentsService, linesService, type User as ApiUser, type Segment, type Line } from "@/services/api";
import { Loader2 } from "lucide-react";

interface User {
  id: string;
  name: string;
  email: string;
  role: 'admin' | 'supervisor' | 'operador';
  segment?: number;
  line?: number;
  lineName?: string;
  isOnline: boolean;
}

const roleColors = {
  admin: "bg-destructive text-destructive-foreground",
  supervisor: "bg-warning text-warning-foreground",
  operador: "bg-success text-success-foreground"
};

const roleLabels = {
  admin: "Admin",
  supervisor: "Supervisor",
  operador: "Operador"
};

// Map API role to frontend role
const mapRole = (apiRole: string): 'admin' | 'supervisor' | 'operador' => {
  switch (apiRole) {
    case 'admin': return 'admin';
    case 'supervisor': return 'supervisor';
    case 'operator': return 'operador';
    default: return 'operador';
  }
};

// Map frontend role to API role
const mapRoleToApi = (role: string): 'admin' | 'supervisor' | 'operator' => {
  switch (role) {
    case 'admin': return 'admin';
    case 'supervisor': return 'supervisor';
    case 'operador': return 'operator';
    default: return 'operator';
  }
};

export default function Usuarios() {
  const [users, setUsers] = useState<User[]>([]);
  const [segments, setSegments] = useState<Segment[]>([]);
  const [lines, setLines] = useState<Line[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [editingUser, setEditingUser] = useState<User | null>(null);
  const [formData, setFormData] = useState({ 
    name: '', 
    email: '', 
    password: '', 
    role: 'operador', 
    segment: '',
    line: '' 
  });

  // Load data on mount
  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    setIsLoading(true);
    try {
      const [usersData, segmentsData, linesData] = await Promise.all([
        usersService.list(),
        segmentsService.list(),
        linesService.list()
      ]);

      setUsers(usersData.map((u: ApiUser) => ({
        id: String(u.id),
        name: u.name,
        email: u.email,
        role: mapRole(u.role),
        segment: u.segment ?? undefined,
        line: u.line ?? undefined,
        lineName: linesData.find(l => l.id === u.line)?.phone,
        isOnline: u.status === 'Online'
      })));

      setSegments(segmentsData);
      setLines(linesData);
    } catch (error) {
      console.error('Error loading data:', error);
      toast({
        title: "Erro ao carregar dados",
        description: "Não foi possível carregar a lista de usuários",
        variant: "destructive"
      });
    } finally {
      setIsLoading(false);
    }
  };

  const columns: Column<User>[] = [
    { key: "name", label: "Nome" },
    { key: "email", label: "Email" },
    {
      key: "role",
      label: "Perfil",
      render: (user) => (
        <Badge className={roleColors[user.role]}>
          {roleLabels[user.role]}
        </Badge>
      )
    },
    { 
      key: "lineName", 
      label: "Linha",
      render: (user) => user.lineName || '-'
    },
    {
      key: "isOnline",
      label: "Status",
      render: (user) => (
        <div className="flex items-center gap-2">
          <div className={cn(
            "w-2 h-2 rounded-full",
            user.isOnline ? "bg-success" : "bg-muted-foreground"
          )} />
          <span className="text-sm">{user.isOnline ? "Online" : "Offline"}</span>
        </div>
      )
    }
  ];

  const handleAdd = () => {
    setEditingUser(null);
    setFormData({ name: '', email: '', password: '', role: 'operador', segment: '', line: '' });
    setIsFormOpen(true);
  };

  const handleEdit = (user: User) => {
    setEditingUser(user);
    setFormData({ 
      name: user.name, 
      email: user.email, 
      password: '', 
      role: user.role, 
      segment: user.segment ? String(user.segment) : '',
      line: user.line ? String(user.line) : ''
    });
    setIsFormOpen(true);
  };

  const handleDelete = async (user: User) => {
    try {
      await usersService.delete(Number(user.id));
      setUsers(users.filter(u => u.id !== user.id));
      toast({
        title: "Usuário removido",
        description: `O usuário ${user.name} foi removido com sucesso`,
      });
    } catch (error) {
      console.error('Error deleting user:', error);
      toast({
        title: "Erro ao remover",
        description: "Não foi possível remover o usuário",
        variant: "destructive"
      });
    }
  };

  const handleSave = async () => {
    if (!formData.name || !formData.email) {
      toast({
        title: "Campos obrigatórios",
        description: "Preencha o nome e email do usuário",
        variant: "destructive"
      });
      return;
    }

    if (!editingUser && !formData.password) {
      toast({
        title: "Senha obrigatória",
        description: "Informe uma senha para o novo usuário",
        variant: "destructive"
      });
      return;
    }

    setIsSaving(true);
    try {
      if (editingUser) {
        const updateData: Parameters<typeof usersService.update>[1] = {
          name: formData.name,
          email: formData.email,
          role: mapRoleToApi(formData.role),
          segment: formData.segment ? Number(formData.segment) : null,
          line: formData.line ? Number(formData.line) : null,
        };
        if (formData.password) {
          updateData.password = formData.password;
        }

        const updated = await usersService.update(Number(editingUser.id), updateData);
        setUsers(users.map(u => u.id === editingUser.id ? {
          id: String(updated.id),
          name: updated.name,
          email: updated.email,
          role: mapRole(updated.role),
          segment: updated.segment ?? undefined,
          line: updated.line ?? undefined,
          lineName: lines.find(l => l.id === updated.line)?.phone,
          isOnline: updated.status === 'Online'
        } : u));
        toast({
          title: "Usuário atualizado",
          description: `O usuário ${updated.name} foi atualizado com sucesso`,
        });
      } else {
        const created = await usersService.create({
          name: formData.name,
          email: formData.email,
          password: formData.password,
          role: mapRoleToApi(formData.role),
          segment: formData.segment ? Number(formData.segment) : undefined,
          line: formData.line ? Number(formData.line) : undefined,
        });
        setUsers([...users, {
          id: String(created.id),
          name: created.name,
          email: created.email,
          role: mapRole(created.role),
          segment: created.segment ?? undefined,
          line: created.line ?? undefined,
          lineName: lines.find(l => l.id === created.line)?.phone,
          isOnline: created.status === 'Online'
        }]);
        toast({
          title: "Usuário criado",
          description: `O usuário ${created.name} foi criado com sucesso`,
        });
      }
      setIsFormOpen(false);
    } catch (error) {
      console.error('Error saving user:', error);
      toast({
        title: "Erro ao salvar",
        description: error instanceof Error ? error.message : "Não foi possível salvar o usuário",
        variant: "destructive"
      });
    } finally {
      setIsSaving(false);
    }
  };

  const renderForm = () => (
    <div className="space-y-4 py-4">
      <div className="space-y-2">
        <Label htmlFor="name">Nome</Label>
        <Input
          id="name"
          value={formData.name}
          onChange={(e) => setFormData({ ...formData, name: e.target.value })}
        />
      </div>
      <div className="space-y-2">
        <Label htmlFor="email">Email</Label>
        <Input
          id="email"
          type="email"
          value={formData.email}
          onChange={(e) => setFormData({ ...formData, email: e.target.value })}
        />
      </div>
      <div className="space-y-2">
        <Label htmlFor="password">Senha {editingUser && "(deixe em branco para manter)"}</Label>
        <Input
          id="password"
          type="password"
          value={formData.password}
          onChange={(e) => setFormData({ ...formData, password: e.target.value })}
          placeholder={editingUser ? "••••••••" : ""}
        />
      </div>
      <div className="space-y-2">
        <Label htmlFor="role">Perfil</Label>
        <Select value={formData.role} onValueChange={(value) => setFormData({ ...formData, role: value })}>
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="admin">Administrador</SelectItem>
            <SelectItem value="supervisor">Supervisor</SelectItem>
            <SelectItem value="operador">Operador</SelectItem>
          </SelectContent>
        </Select>
      </div>
      {(formData.role === 'operador' || formData.role === 'supervisor') && (
        <div className="space-y-2">
          <Label htmlFor="segment">Segmento</Label>
          <Select value={formData.segment} onValueChange={(value) => setFormData({ ...formData, segment: value })}>
            <SelectTrigger>
              <SelectValue placeholder="Selecione um segmento" />
            </SelectTrigger>
            <SelectContent>
              {segments.map((segment) => (
                <SelectItem key={segment.id} value={String(segment.id)}>
                  {segment.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}
      <div className="space-y-2">
        <Label htmlFor="line">Linha WhatsApp</Label>
        <Select value={formData.line} onValueChange={(value) => setFormData({ ...formData, line: value })}>
          <SelectTrigger>
            <SelectValue placeholder="Selecione uma linha" />
          </SelectTrigger>
          <SelectContent>
            {lines.map((line) => (
              <SelectItem key={line.id} value={String(line.id)}>
                {line.phone} {line.oficial ? "(Oficial)" : `(${line.evolutionName})`}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <p className="text-xs text-muted-foreground">Define qual linha será usada para envio de mensagens</p>
      </div>
      <DialogFooter>
        <Button variant="outline" onClick={() => setIsFormOpen(false)} disabled={isSaving}>
          Cancelar
        </Button>
        <Button onClick={handleSave} disabled={isSaving}>
          {isSaving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
          Salvar
        </Button>
      </DialogFooter>
    </div>
  );

  if (isLoading) {
    return (
      <MainLayout>
        <div className="flex items-center justify-center h-64">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
        </div>
      </MainLayout>
    );
  }

  return (
    <MainLayout>
      <div className="animate-fade-in">
        <CrudTable
          title="Usuários"
          subtitle="Gerenciar usuários do sistema"
          columns={columns}
          data={users}
          searchPlaceholder="Buscar usuários..."
          onAdd={handleAdd}
          onEdit={handleEdit}
          onDelete={handleDelete}
          renderForm={renderForm}
          isFormOpen={isFormOpen}
          onFormOpenChange={setIsFormOpen}
          editingItem={editingUser}
        />
      </div>
    </MainLayout>
  );
}
