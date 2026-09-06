"use client";

import { useState, useCallback, useEffect } from "react";
import { useParams, useRouter } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { BrandLoader } from "@/components/shared/brand-loader";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import Link from "next/link";
import {
  ArrowLeft,
  Building2,
  Phone,
  Mail,
  Globe,
  MapPin,
  ExternalLink,
  AtSign,
  Shield,
  Clock,
  Calendar,
  Edit3,
  Trash2,
  Save,
  X,
  Plus,
  MessageSquare,
  BadgeCheck,
  AlertCircle,
  Loader2,
} from "lucide-react";
import type { Lead, LeadNote, LeadSource } from "@/types";
import { getMapUrl } from "@/lib/utils";
import { api } from "@/lib/api";

function formatDate(dateString: string): string {
  const date = new Date(dateString);
  return date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function formatDateTime(dateString: string): string {
  const date = new Date(dateString);
  return date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function getConfidenceBadge(confidence: string | null) {
  if (!confidence) return <span className="text-xs text-muted-foreground">—</span>;
  const variants: Record<string, { className: string; icon: React.ReactNode }> = {
    high: {
      className: "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400",
      icon: <BadgeCheck className="h-3 w-3" />,
    },
    medium: {
      className: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400",
      icon: <AlertCircle className="h-3 w-3" />,
    },
    low: {
      className: "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400",
      icon: <AlertCircle className="h-3 w-3" />,
    },
  };

  const config = variants[confidence] || variants.medium;
  return (
    <Badge className={`text-xs font-medium gap-1 ${config.className}`}>
      {config.icon}
      {confidence.charAt(0).toUpperCase() + confidence.slice(1)}
    </Badge>
  );
}

export default function LeadDetailPage() {
  const params = useParams();
  const router = useRouter();
  const leadId = params.id as string;

  const [lead, setLead] = useState<Lead | null>(null);
  const [notes, setNotes] = useState<LeadNote[]>([]);
  const [sources, setSources] = useState<LeadSource[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [isEditing, setIsEditing] = useState(false);
  const [editData, setEditData] = useState<Partial<Lead>>({});
  const [saving, setSaving] = useState(false);
  const [newNote, setNewNote] = useState("");
  const [addingNote, setAddingNote] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const fetchLead = useCallback(async () => {
    try {
      const data = await api.get<{ sources: LeadSource[]; notes: LeadNote[] } & Lead>(`/leads/${leadId}`);
      const { sources: leadSources, notes: leadNotes, ...leadFields } = data;
      setLead(leadFields as Lead);
      setSources(leadSources || []);
      setNotes(leadNotes || []);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load lead");
    } finally {
      setLoading(false);
    }
  }, [leadId]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    fetchLead();
  }, [fetchLead]);

  const handleStartEdit = useCallback(() => {
    if (!lead) return;
    setEditData({
      business_name: lead.business_name,
      contact_person: lead.contact_person || "",
      phone: lead.phone || "",
      email: lead.email || "",
      website: lead.website || "",
      instagram: lead.instagram || "",
      facebook: lead.facebook || "",
      linkedin: lead.linkedin || "",
      address: lead.address || "",
      city: lead.city || "",
      country: lead.country || "",
      category: lead.category || "",
    });
    setIsEditing(true);
  }, [lead]);

  const handleCancelEdit = useCallback(() => {
    setIsEditing(false);
    setEditData({});
  }, []);

  const handleSaveEdit = useCallback(async () => {
    setSaving(true);
    try {
      const updated = await api.put<Lead>(`/leads/${leadId}`, editData);
      setLead(updated);
      setIsEditing(false);
      setEditData({});
    } catch {
      alert("Failed to save changes. Please try again.");
    } finally {
      setSaving(false);
    }
  }, [leadId, editData]);

  const handleAddNote = useCallback(async () => {
    if (!newNote.trim()) return;
    setAddingNote(true);
    try {
      const created = await api.post<LeadNote>(`/leads/${leadId}/notes`, { note: newNote.trim() });
      setNotes((prev) => [created, ...prev]);
      setNewNote("");
    } catch {
      alert("Failed to add note. Please try again.");
    } finally {
      setAddingNote(false);
    }
  }, [newNote, leadId]);

  const handleDelete = useCallback(() => {
    setDeleteDialogOpen(true);
  }, []);

  const confirmDelete = useCallback(async () => {
    setDeleting(true);
    try {
      await api.del(`/leads/${leadId}`);
      router.push("/crm");
    } catch {
      alert("Failed to delete lead. Please try again.");
      setDeleting(false);
      setDeleteDialogOpen(false);
    }
  }, [leadId, router]);

  const updateEditField = useCallback((field: string, value: string) => {
    setEditData((prev) => ({ ...prev, [field]: value }));
  }, []);

  if (loading) {
    return (
      <BrandLoader label="Loading lead…" className="py-24" />
    );
  }

  if (error || !lead) {
    return (
      <div className="flex flex-col items-center justify-center gap-4 py-24">
        <AlertCircle className="h-12 w-12 text-destructive" />
        <h2 className="text-xl font-semibold">Lead Not Found</h2>
        <p className="text-muted-foreground text-sm">{error}</p>
        <Link href="/crm">
          <Button variant="outline">Back to CRM</Button>
        </Link>
      </div>
    );
  }

  const mapUrl = getMapUrl(lead);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="space-y-1">
          <Link href="/crm">
            <Button variant="ghost" size="sm" className="gap-1 -ml-2 mb-1">
              <ArrowLeft className="h-4 w-4" />
              Back to CRM
            </Button>
          </Link>
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-bold tracking-tight">{lead.business_name}</h1>
          </div>
          <p className="text-sm text-muted-foreground">{lead.category || "No category"}</p>
        </div>
        <div className="flex items-center gap-2">
          {isEditing ? (
            <>
              <Button variant="outline" size="sm" onClick={handleCancelEdit} className="gap-1" disabled={saving}>
                <X className="h-4 w-4" />
                Cancel
              </Button>
              <Button size="sm" onClick={handleSaveEdit} className="gap-1" disabled={saving}>
                {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                Save Changes
              </Button>
            </>
          ) : (
            <>
              <Button variant="outline" size="sm" onClick={handleStartEdit} className="gap-1">
                <Edit3 className="h-4 w-4" />
                Edit
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={handleDelete}
                className="gap-1 text-destructive hover:text-destructive"
              >
                <Trash2 className="h-4 w-4" />
                Delete
              </Button>
            </>
          )}
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        {/* Left Column - Main Info */}
        <div className="lg:col-span-2 space-y-6">
          {/* Business Information */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center gap-2">
                <Building2 className="h-4 w-4" />
                Business Information
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <Label className="text-xs text-muted-foreground">Business Name</Label>
                  {isEditing ? (
                    <Input
                      value={editData.business_name ?? lead.business_name}
                      onChange={(e) => updateEditField("business_name", e.target.value)}
                      className="mt-1 h-9"
                    />
                  ) : (
                    <p className="text-sm font-medium mt-1">{lead.business_name}</p>
                  )}
                </div>
                <div>
                  <Label className="text-xs text-muted-foreground">Category</Label>
                  {isEditing ? (
                    <Input
                      value={editData.category ?? ""}
                      onChange={(e) => updateEditField("category", e.target.value)}
                      className="mt-1 h-9"
                    />
                  ) : (
                    <p className="text-sm mt-1">{lead.category || "—"}</p>
                  )}
                </div>
                <div className="sm:col-span-2">
                  <Label className="text-xs text-muted-foreground">Address</Label>
                  {isEditing ? (
                    <Input
                      value={editData.address ?? ""}
                      onChange={(e) => updateEditField("address", e.target.value)}
                      className="mt-1 h-9"
                    />
                  ) : (
                    <div className="text-sm mt-1 flex items-center gap-1.5">
                      {mapUrl ? (
                        <a
                          href={mapUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="flex items-center gap-1.5 text-blue-600 hover:underline dark:text-blue-400 min-w-0"
                        >
                          <MapPin className="h-3.5 w-3.5 shrink-0" />
                          <span className="truncate">{lead.address || "—"}</span>
                          <ExternalLink className="h-3 w-3 shrink-0" />
                        </a>
                      ) : (
                        <>
                          <MapPin className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                          <span>{lead.address || "—"}</span>
                        </>
                      )}
                    </div>
                  )}
                </div>
                <div>
                  <Label className="text-xs text-muted-foreground">City</Label>
                  {isEditing ? (
                    <Input
                      value={editData.city ?? ""}
                      onChange={(e) => updateEditField("city", e.target.value)}
                      className="mt-1 h-9"
                    />
                  ) : (
                    <p className="text-sm mt-1">{lead.city || "—"}</p>
                  )}
                </div>
                <div>
                  <Label className="text-xs text-muted-foreground">Country</Label>
                  {isEditing ? (
                    <Input
                      value={editData.country ?? ""}
                      onChange={(e) => updateEditField("country", e.target.value)}
                      className="mt-1 h-9"
                    />
                  ) : (
                    <p className="text-sm mt-1">{lead.country || "—"}</p>
                  )}
                </div>
                <div>
                  <Label className="text-xs text-muted-foreground">Website</Label>
                  {isEditing ? (
                    <Input
                      value={editData.website ?? ""}
                      onChange={(e) => updateEditField("website", e.target.value)}
                      className="mt-1 h-9"
                    />
                  ) : lead.website ? (
                    <a
                      href={lead.website}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-sm mt-1 flex items-center gap-1.5 text-blue-600 hover:underline dark:text-blue-400"
                    >
                      <Globe className="h-3.5 w-3.5 shrink-0" />
                      {lead.website.replace(/^https?:\/\//, "")}
                      <ExternalLink className="h-3 w-3" />
                    </a>
                  ) : (
                    <p className="text-sm mt-1">—</p>
                  )}
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Contact */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center gap-2">
                <Phone className="h-4 w-4" />
                Contact
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <Label className="text-xs text-muted-foreground">Phone</Label>
                  {isEditing ? (
                    <Input
                      value={editData.phone ?? ""}
                      onChange={(e) => updateEditField("phone", e.target.value)}
                      className="mt-1 h-9"
                    />
                  ) : (
                    <div className="flex items-center gap-2 mt-1">
                      <p className="text-sm">{lead.phone || "—"}</p>
                      {lead.phone && (
                        <Badge
                          variant="outline"
                          className={`text-[10px] ${
                            lead.phone_valid
                              ? "border-green-300 text-green-700 dark:border-green-700 dark:text-green-400"
                              : "border-red-300 text-red-700 dark:border-red-700 dark:text-red-400"
                          }`}
                        >
                          {lead.phone_valid ? "Valid" : "Invalid"}
                        </Badge>
                      )}
                    </div>
                  )}
                </div>
                <div>
                  <Label className="text-xs text-muted-foreground">Contact Person</Label>
                  {isEditing ? (
                    <Input
                      value={editData.contact_person ?? ""}
                      onChange={(e) => updateEditField("contact_person", e.target.value)}
                      className="mt-1 h-9"
                    />
                  ) : (
                    <p className="text-sm mt-1">{lead.contact_person || "—"}</p>
                  )}
                </div>
                <div className="sm:col-span-2">
                  <Label className="text-xs text-muted-foreground">Email</Label>
                  {isEditing ? (
                    <Input
                      value={editData.email ?? ""}
                      onChange={(e) => updateEditField("email", e.target.value)}
                      className="mt-1 h-9"
                    />
                  ) : lead.email ? (
                    <a
                      href={`mailto:${lead.email}`}
                      className="text-sm mt-1 flex items-center gap-1.5 text-blue-600 hover:underline dark:text-blue-400"
                    >
                      <Mail className="h-3.5 w-3.5 shrink-0" />
                      {lead.email}
                    </a>
                  ) : (
                    <p className="text-sm mt-1">—</p>
                  )}
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Social */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center gap-2">
                <Globe className="h-4 w-4" />
                Social
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid gap-4 sm:grid-cols-3">
                <div>
                  <Label className="text-xs text-muted-foreground flex items-center gap-1">
                    <AtSign className="h-3 w-3" /> Instagram
                  </Label>
                  {isEditing ? (
                    <Input
                      value={editData.instagram ?? ""}
                      onChange={(e) => updateEditField("instagram", e.target.value)}
                      className="mt-1 h-9"
                      placeholder="@username"
                    />
                  ) : lead.instagram ? (
                    <a
                      href={`https://instagram.com/${lead.instagram.replace("@", "")}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-sm mt-1 flex items-center gap-1.5 text-blue-600 hover:underline dark:text-blue-400"
                    >
                      {lead.instagram}
                      <ExternalLink className="h-3 w-3" />
                    </a>
                  ) : (
                    <p className="text-sm mt-1 text-muted-foreground">Not found</p>
                  )}
                </div>
                <div>
                  <Label className="text-xs text-muted-foreground flex items-center gap-1">
                    <AtSign className="h-3 w-3" /> Facebook
                  </Label>
                  {isEditing ? (
                    <Input
                      value={editData.facebook ?? ""}
                      onChange={(e) => updateEditField("facebook", e.target.value)}
                      className="mt-1 h-9"
                      placeholder="https://facebook.com/..."
                    />
                  ) : lead.facebook ? (
                    <a
                      href={lead.facebook}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-sm mt-1 flex items-center gap-1.5 text-blue-600 hover:underline dark:text-blue-400"
                    >
                      {lead.facebook.replace(/^https?:\/\//, "").replace(/^www\./, "")}
                      <ExternalLink className="h-3 w-3" />
                    </a>
                  ) : (
                    <p className="text-sm mt-1 text-muted-foreground">Not found</p>
                  )}
                </div>
                <div>
                  <Label className="text-xs text-muted-foreground flex items-center gap-1">
                    <AtSign className="h-3 w-3" /> LinkedIn
                  </Label>
                  {isEditing ? (
                    <Input
                      value={editData.linkedin ?? ""}
                      onChange={(e) => updateEditField("linkedin", e.target.value)}
                      className="mt-1 h-9"
                      placeholder="https://linkedin.com/in/..."
                    />
                  ) : lead.linkedin ? (
                    <a
                      href={lead.linkedin}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-sm mt-1 flex items-center gap-1.5 text-blue-600 hover:underline dark:text-blue-400"
                    >
                      {lead.linkedin.replace(/^https?:\/\//, "").replace(/^www\./, "")}
                      <ExternalLink className="h-3 w-3" />
                    </a>
                  ) : (
                    <p className="text-sm mt-1 text-muted-foreground">Not found</p>
                  )}
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Right Column - Sidebar Info */}
        <div className="space-y-6">
          {/* Verification */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center gap-2">
                <Shield className="h-4 w-4" />
                Verification
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-xs text-muted-foreground">Source</span>
                <span className="text-sm">{sources.length > 0 ? sources[0].source : "—"}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-xs text-muted-foreground">Confidence</span>
                {getConfidenceBadge(lead.confidence)}
              </div>
              <div className="flex items-center justify-between">
                <span className="text-xs text-muted-foreground">Verified</span>
                <Badge
                  variant="outline"
                  className={`text-xs ${
                    lead.verified
                      ? "border-green-300 text-green-700 dark:border-green-700 dark:text-green-400"
                      : "border-gray-300 text-gray-500"
                  }`}
                >
                  {lead.verified ? "Yes" : "No"}
                </Badge>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-xs text-muted-foreground">Last Checked</span>
                <span className="text-sm">
                  {lead.last_checked ? formatDateTime(lead.last_checked) : "—"}
                </span>
              </div>
              {sources.length > 0 && (
                <div className="pt-2 border-t">
                  <Label className="text-xs text-muted-foreground">Data Sources</Label>
                  <div className="mt-2 space-y-1.5">
                    {sources.map((source) => (
                      <div key={source.id} className="flex items-center justify-between text-xs">
                        <span className="text-muted-foreground truncate mr-2">{source.field_name}</span>
                        <Badge
                          variant="outline"
                          className={`text-[10px] shrink-0 ${
                            source.confidence === "high"
                              ? "border-green-300 text-green-700 dark:border-green-700 dark:text-green-400"
                              : source.confidence === "medium"
                              ? "border-yellow-300 text-yellow-700 dark:border-yellow-700 dark:text-yellow-400"
                              : "border-red-300 text-red-700 dark:border-red-700 dark:text-red-400"
                          }`}
                        >
                          {source.confidence}
                        </Badge>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Details */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center gap-2">
                <BadgeCheck className="h-4 w-4" />
                Details
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground flex items-center gap-1">
                  <Calendar className="h-3.5 w-3.5" /> Created
                </span>
                <span>{formatDate(lead.created_at)}</span>
              </div>
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground flex items-center gap-1">
                  <Clock className="h-3.5 w-3.5" /> Updated
                </span>
                <span>{formatDate(lead.updated_at)}</span>
              </div>
            </CardContent>
          </Card>

          {/* Notes */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center gap-2">
                <MessageSquare className="h-4 w-4" />
                Notes
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {/* Add Note */}
              <div>
                <Textarea
                  placeholder="Add a note about this lead..."
                  value={newNote}
                  onChange={(e) => setNewNote(e.target.value)}
                  rows={3}
                  className="resize-none"
                  disabled={addingNote}
                />
                <Button
                  size="sm"
                  className="mt-2 gap-1"
                  disabled={!newNote.trim() || addingNote}
                  onClick={handleAddNote}
                >
                  {addingNote ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />}
                  Add Note
                </Button>
              </div>

              {/* Notes List */}
              {notes.length === 0 ? (
                <p className="text-sm text-muted-foreground">No notes yet.</p>
              ) : (
                <div className="space-y-3">
                  {notes.map((note) => (
                    <div key={note.id} className="rounded-lg border p-3">
                      <p className="text-sm">{note.note}</p>
                      <p className="text-xs text-muted-foreground mt-2">
                        {formatDateTime(note.created_at)}
                      </p>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>

      {/* Delete Confirmation Dialog */}
      <Dialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete Lead</DialogTitle>
            <DialogDescription>
              Are you sure you want to delete &ldquo;{lead.business_name}&rdquo;? This action cannot be undone.
              All associated notes and sources will also be removed.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteDialogOpen(false)} disabled={deleting}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={confirmDelete} disabled={deleting}>
              {deleting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              Delete Lead
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
