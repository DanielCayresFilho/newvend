import { useState, useEffect, useCallback, useMemo } from "react";
import { Search, Loader2, ChevronLeft, ChevronRight } from "lucide-react";
import { MainLayout } from "@/components/layout/MainLayout";
import { GlassCard } from "@/components/ui/glass-card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Pencil, Trash2, Plus, Package } from "lucide-react";
import { toast } from "@/hooks/use-toast";
import { templatesService, linesService, Template as APITemplate, Line } from "@/services/api";

interface Template {
  id: string;
  name: string;
  lineId: string;
  lineName: string;
  category: string;
  status: 'APPROVED' | 'PENDING' | 'REJECTED';
  body: string;
  header?: string;
  headerType?: string;
  footer?: string;
  namespace?: string;
  language?: string;
  variables?: string;
}

const statusColors: Record<string, string> = {
  APPROVED: "bg-success",
  PENDING: "bg-warning text-warning-foreground",
  REJECTED: "bg-destructive"
};

const statusLabels: Record<string, string> = {
  APPROVED: "Aprovado",
  PENDING: "Pendente",
  REJECTED: "Rejeitado"
};

const PAGE_SIZE_OPTIONS = [10, 25, 50, 100];

export default function Templates() {
  const [templates, setTemplates] = useState<Template[]>([]);
  const [lines, setLines] = useState<Line[]>([]);
  const [filters, setFilters] = useState({ search: '', line: '', status: '' });
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [editingTemplate, setEditingTemplate] = useState<Template | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [formData, setFormData] = useState<{
    name: string;
    lineId: string;
    language: string;
    category: string;
    namespace: string;
    headerType: string;
    header: string;
    body: string;
    footer: string;
    variables: string;
    status: 'APPROVED' | 'PENDING' | 'REJECTED';
  }>({
    name: '',
    lineId: '',
    language: 'pt_BR',
    category: '',
    namespace: '',
    headerType: 'TEXT',
    header: '',
    body: '',
    footer: '',
    variables: '',
    status: 'PENDING'
  });

  const mapApiToLocal = useCallback((apiTemplate: APITemplate): Template => {
    const line = lines.find(l => l.id === apiTemplate.lineId);
    return {
      id: apiTemplate.id.toString(),
      name: apiTemplate.name,
      lineId: apiTemplate.lineId.toString(),
      lineName: line?.phone || `Linha ${apiTemplate.lineId}`,
      category: apiTemplate.category,
      status: apiTemplate.status,
      body: apiTemplate.bodyText,
      header: apiTemplate.headerContent,
      headerType: apiTemplate.headerType,
      footer: apiTemplate.footerText,
      namespace: apiTemplate.namespace,
      language: apiTemplate.language,
      variables: apiTemplate.variables?.join(', '),
    };
  }, [lines]);

  const loadTemplates = useCallback(async () => {
    try {
      setIsLoading(true);
      const data = await templatesService.list();
      setTemplates(data.map(mapApiToLocal));
    } catch (error) {
      toast({
        title: "Erro ao carregar templates",
        description: error instanceof Error ? error.message : "Erro desconhecido",
        variant: "destructive",
      });
    } finally {
      setIsLoading(false);
    }
  }, [mapApiToLocal]);

  const loadLines = useCallback(async () => {
    try {
      const data = await linesService.list();
      setLines(data);
    } catch (error) {
      console.error('Error loading lines:', error);
    }
  }, []);

  useEffect(() => {
    loadLines();
  }, [loadLines]);

  useEffect(() => {
    if (lines.length > 0) {
      loadTemplates();
    }
  }, [lines, loadTemplates]);

  const filteredTemplates = useMemo(() => {
    return templates.filter(t => {
      if (filters.search && !t.name.toLowerCase().includes(filters.search.toLowerCase())) return false;
      if (filters.line && filters.line !== 'all' && t.lineId !== filters.line) return false;
      if (filters.status && filters.status !== 'all' && t.status !== filters.status) return false;
      return true;
    });
  }, [templates, filters]);

  // Reset page when filters change
  useEffect(() => {
    setCurrentPage(1);
  }, [filters]);

  // Pagination calculations
  const totalItems = filteredTemplates.length;
  const totalPages = Math.ceil(totalItems / pageSize);
  
  const paginatedTemplates = useMemo(() => {
    const startIndex = (currentPage - 1) * pageSize;
    return filteredTemplates.slice(startIndex, startIndex + pageSize);
  }, [filteredTemplates, currentPage, pageSize]);

  const handlePageSizeChange = useCallback((value: string) => {
    setPageSize(Number(value));
    setCurrentPage(1);
  }, []);

  const goToPage = useCallback((page: number) => {
    setCurrentPage(Math.max(1, Math.min(page, totalPages)));
  }, [totalPages]);

  const pageNumbers = useMemo(() => {
    const pages: (number | 'ellipsis')[] = [];
    const maxVisible = 5;
    
    if (totalPages <= maxVisible) {
      for (let i = 1; i <= totalPages; i++) pages.push(i);
    } else {
      pages.push(1);
      if (currentPage > 3) pages.push('ellipsis');
      const start = Math.max(2, currentPage - 1);
      const end = Math.min(totalPages - 1, currentPage + 1);
      for (let i = start; i <= end; i++) {
        if (!pages.includes(i)) pages.push(i);
      }
      if (currentPage < totalPages - 2) pages.push('ellipsis');
      if (!pages.includes(totalPages)) pages.push(totalPages);
    }
    return pages;
  }, [totalPages, currentPage]);

  const startItem = totalItems === 0 ? 0 : (currentPage - 1) * pageSize + 1;
  const endItem = Math.min(currentPage * pageSize, totalItems);

  const handleAdd = () => {
    setEditingTemplate(null);
    setFormData({
      name: '',
      lineId: '',
      language: 'pt_BR',
      category: '',
      namespace: '',
      headerType: 'TEXT',
      header: '',
      body: '',
      footer: '',
      variables: '',
      status: 'PENDING'
    });
    setIsFormOpen(true);
  };

  const handleEdit = (template: Template) => {
    setEditingTemplate(template);
    setFormData({
      name: template.name,
      lineId: template.lineId,
      language: template.language || 'pt_BR',
      category: template.category,
      namespace: template.namespace || '',
      headerType: template.headerType || 'TEXT',
      header: template.header || '',
      body: template.body,
      footer: template.footer || '',
      variables: template.variables || '',
      status: template.status
    });
    setIsFormOpen(true);
  };

  const handleDelete = async (template: Template) => {
    try {
      await templatesService.delete(parseInt(template.id));
      setTemplates(templates.filter(t => t.id !== template.id));
      toast({
        title: "Template excluído",
        description: "Template removido com sucesso",
      });
    } catch (error) {
      toast({
        title: "Erro ao excluir",
        description: error instanceof Error ? error.message : "Erro ao excluir template",
        variant: "destructive",
      });
    }
  };

  const handleSave = async () => {
    if (!formData.name.trim() || !formData.lineId || !formData.body.trim()) {
      toast({
        title: "Campos obrigatórios",
        description: "Nome, linha e corpo são obrigatórios",
        variant: "destructive",
      });
      return;
    }

    setIsSaving(true);
    try {
      const payload = {
        name: formData.name.trim(),
        lineId: parseInt(formData.lineId),
        language: formData.language,
        category: formData.category as 'MARKETING' | 'UTILITY' | 'AUTHENTICATION' || undefined,
        namespace: formData.namespace.trim() || undefined,
        headerType: formData.headerType as 'TEXT' | 'IMAGE' | 'VIDEO' | 'DOCUMENT' || undefined,
        headerContent: formData.header.trim() || undefined,
        bodyText: formData.body.trim(),
        footerText: formData.footer.trim() || undefined,
        variables: formData.variables.trim() ? formData.variables.split(',').map(v => v.trim()) : undefined,
        status: formData.status,
      };

      if (editingTemplate) {
        const updated = await templatesService.update(parseInt(editingTemplate.id), payload);
        setTemplates(templates.map(t => t.id === editingTemplate.id ? mapApiToLocal(updated) : t));
        toast({
          title: "Template atualizado",
          description: "Template atualizado com sucesso",
        });
      } else {
        const created = await templatesService.create(payload);
        setTemplates([...templates, mapApiToLocal(created)]);
        toast({
          title: "Template criado",
          description: "Template criado com sucesso",
        });
      }
      setIsFormOpen(false);
    } catch (error) {
      toast({
        title: "Erro ao salvar",
        description: error instanceof Error ? error.message : "Erro ao salvar template",
        variant: "destructive",
      });
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <MainLayout>
      <div className="space-y-6 animate-fade-in">
        {/* Filters */}
        <GlassCard>
          <div className="flex items-center justify-between mb-4">
            <div>
              <h2 className="text-xl font-semibold text-foreground">Templates</h2>
              <p className="text-sm text-muted-foreground">Gerenciar templates de mensagens</p>
            </div>
            <Button onClick={handleAdd}>
              <Plus className="h-4 w-4 mr-2" />
              Novo Template
            </Button>
          </div>
          
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            <div className="relative md:col-span-2">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Buscar por nome..."
                value={filters.search}
                onChange={(e) => setFilters({ ...filters, search: e.target.value })}
                className="pl-10"
              />
            </div>
            <Select value={filters.line} onValueChange={(value) => setFilters({ ...filters, line: value })}>
              <SelectTrigger>
                <SelectValue placeholder="Todas as linhas" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todas as linhas</SelectItem>
                {lines.map((line) => (
                  <SelectItem key={line.id} value={line.id.toString()}>
                    {line.phone}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={filters.status} onValueChange={(value) => setFilters({ ...filters, status: value })}>
              <SelectTrigger>
                <SelectValue placeholder="Todos os status" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todos os status</SelectItem>
                <SelectItem value="APPROVED">Aprovado</SelectItem>
                <SelectItem value="PENDING">Pendente</SelectItem>
                <SelectItem value="REJECTED">Rejeitado</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </GlassCard>

        {/* Templates Table */}
        <GlassCard padding="none">
          {isLoading ? (
            <div className="flex items-center justify-center py-16">
              <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
            </div>
          ) : filteredTemplates.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-muted-foreground">
              <Package className="h-16 w-16 mb-4 opacity-50" />
              <p className="text-lg font-medium">Nenhum template encontrado</p>
              <p className="text-sm">Clique em "Novo Template" para adicionar</p>
            </div>
          ) : (
            <>
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow className="bg-muted/30">
                      <TableHead>Nome</TableHead>
                      <TableHead>Linha</TableHead>
                      <TableHead>Categoria</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead className="max-w-xs">Corpo</TableHead>
                      <TableHead className="w-24 text-right">Ações</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {paginatedTemplates.map((template) => (
                      <TableRow key={template.id} className="hover:bg-muted/20 transition-colors">
                        <TableCell className="font-medium">{template.name}</TableCell>
                        <TableCell>{template.lineName}</TableCell>
                        <TableCell>{template.category}</TableCell>
                        <TableCell>
                          <Badge className={statusColors[template.status]}>
                            {statusLabels[template.status]}
                          </Badge>
                        </TableCell>
                        <TableCell className="max-w-xs truncate text-sm text-muted-foreground">
                          {template.body}
                        </TableCell>
                        <TableCell className="text-right">
                          <div className="flex justify-end gap-1">
                            <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => handleEdit(template)}>
                              <Pencil className="h-4 w-4" />
                            </Button>
                            <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive hover:text-destructive" onClick={() => handleDelete(template)}>
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>

              {/* Pagination */}
              {totalPages > 1 && (
                <div className="flex flex-col sm:flex-row items-center justify-between gap-4 p-4 border-t border-border/50">
                  <div className="flex items-center gap-2 text-sm text-muted-foreground">
                    <span>Mostrando {startItem}-{endItem} de {totalItems}</span>
                    <span className="hidden sm:inline">|</span>
                    <div className="flex items-center gap-2">
                      <span className="hidden sm:inline">Por página:</span>
                      <Select value={String(pageSize)} onValueChange={handlePageSizeChange}>
                        <SelectTrigger className="w-[70px] h-8">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {PAGE_SIZE_OPTIONS.map((size) => (
                            <SelectItem key={size} value={String(size)}>
                              {size}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  </div>

                  <div className="flex items-center gap-1">
                    <Button
                      variant="outline"
                      size="icon"
                      className="h-8 w-8"
                      onClick={() => goToPage(currentPage - 1)}
                      disabled={currentPage === 1}
                    >
                      <ChevronLeft className="h-4 w-4" />
                    </Button>
                    
                    {pageNumbers.map((page, index) => (
                      page === 'ellipsis' ? (
                        <span key={`ellipsis-${index}`} className="px-2 text-muted-foreground">...</span>
                      ) : (
                        <Button
                          key={page}
                          variant={currentPage === page ? "default" : "outline"}
                          size="icon"
                          className="h-8 w-8"
                          onClick={() => goToPage(page)}
                        >
                          {page}
                        </Button>
                      )
                    ))}
                    
                    <Button
                      variant="outline"
                      size="icon"
                      className="h-8 w-8"
                      onClick={() => goToPage(currentPage + 1)}
                      disabled={currentPage === totalPages}
                    >
                      <ChevronRight className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              )}
            </>
          )}
        </GlassCard>
      </div>

      {/* Template Form Modal */}
      <Dialog open={isFormOpen} onOpenChange={setIsFormOpen}>
        <DialogContent className="sm:max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editingTemplate ? 'Editar' : 'Novo'} Template</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="name">Nome *</Label>
                <Input
                  id="name"
                  value={formData.name}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="line">Linha *</Label>
                <Select value={formData.lineId} onValueChange={(value) => setFormData({ ...formData, lineId: value })}>
                  <SelectTrigger>
                    <SelectValue placeholder="Selecione" />
                  </SelectTrigger>
                  <SelectContent>
                    {lines.map((line) => (
                      <SelectItem key={line.id} value={line.id.toString()}>
                        {line.phone}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="language">Idioma</Label>
                <Select value={formData.language} onValueChange={(value) => setFormData({ ...formData, language: value })}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="pt_BR">Português (Brasil)</SelectItem>
                    <SelectItem value="en_US">English (US)</SelectItem>
                    <SelectItem value="es">Español</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="category">Categoria</Label>
                <Select value={formData.category} onValueChange={(value) => setFormData({ ...formData, category: value })}>
                  <SelectTrigger>
                    <SelectValue placeholder="Selecione" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="MARKETING">Marketing</SelectItem>
                    <SelectItem value="UTILITY">Utilitário</SelectItem>
                    <SelectItem value="AUTHENTICATION">Autenticação</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            
            <div className="space-y-2">
              <Label htmlFor="namespace">Namespace</Label>
              <Input
                id="namespace"
                value={formData.namespace}
                onChange={(e) => setFormData({ ...formData, namespace: e.target.value })}
                placeholder="ex: vend_templates"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="headerType">Tipo de Header</Label>
              <Select value={formData.headerType} onValueChange={(value) => setFormData({ ...formData, headerType: value })}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="TEXT">Texto</SelectItem>
                  <SelectItem value="IMAGE">Imagem</SelectItem>
                  <SelectItem value="VIDEO">Vídeo</SelectItem>
                  <SelectItem value="DOCUMENT">Documento</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {formData.headerType === 'TEXT' && (
              <div className="space-y-2">
                <Label htmlFor="header">Header</Label>
                <Input
                  id="header"
                  value={formData.header}
                  onChange={(e) => setFormData({ ...formData, header: e.target.value })}
                  placeholder="Cabeçalho da mensagem"
                />
              </div>
            )}

            <div className="space-y-2">
              <Label htmlFor="body">Corpo do Template *</Label>
              <Textarea
                id="body"
                value={formData.body}
                onChange={(e) => setFormData({ ...formData, body: e.target.value })}
                placeholder="Use {{1}}, {{2}}, etc. para variáveis"
                rows={4}
              />
              <p className="text-xs text-muted-foreground">
                Use {"{{1}}"}, {"{{2}}"}, etc. para inserir variáveis dinâmicas
              </p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="footer">Rodapé</Label>
              <Input
                id="footer"
                value={formData.footer}
                onChange={(e) => setFormData({ ...formData, footer: e.target.value })}
                placeholder="Texto do rodapé"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="variables">Variáveis</Label>
              <Input
                id="variables"
                value={formData.variables}
                onChange={(e) => setFormData({ ...formData, variables: e.target.value })}
                placeholder="nome, valor, data (separados por vírgula)"
              />
              <p className="text-xs text-muted-foreground">
                Liste as variáveis separadas por vírgula, na ordem correspondente
              </p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="status">Status</Label>
              <Select value={formData.status} onValueChange={(value: 'APPROVED' | 'PENDING' | 'REJECTED') => setFormData({ ...formData, status: value })}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="APPROVED">Aprovado</SelectItem>
                  <SelectItem value="PENDING">Pendente</SelectItem>
                  <SelectItem value="REJECTED">Rejeitado</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsFormOpen(false)} disabled={isSaving}>
              Cancelar
            </Button>
            <Button onClick={handleSave} disabled={isSaving}>
              {isSaving ? 'Salvando...' : 'Salvar'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </MainLayout>
  );
}
