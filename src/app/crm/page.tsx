"use client";

import { useState, useMemo, useCallback, useEffect } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
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
  Search,
  Download,
  Trash2,
  Eye,
  Pencil,
  ChevronLeft,
  ChevronRight,
  CheckSquare,
  Square,
  X,
  Users,
  Loader2,
  AlertCircle,
  AtSign,
  ThumbsUp,
  Briefcase,
  MapPin,
} from "lucide-react";
import { getMapUrl } from "@/lib/utils";
import type { Lead, Search as SearchType } from "@/types";
import { api, downloadPost, getCurrentUser, type AuthUser } from "@/lib/api";

const LEADS_PER_PAGE = 15;

export default function CRMPage() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const urlSearchId = searchParams.get("search_id") || "";

  const [leads, setLeads] = useState<Lead[]>([]);
  const [total, setTotal] = useState(0);
  const [totalPages, setTotalPages] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [searchQuery, setSearchQuery] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [filterCity, setFilterCity] = useState("");
  const [filterCountry, setFilterCountry] = useState("");
  const [filterCategory, setFilterCategory] = useState("");
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [currentPage, setCurrentPage] = useState(1);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [leadToDelete, setLeadToDelete] = useState<string | null>(null);
  const [deleteAllOpen, setDeleteAllOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [exportFormat, setExportFormat] = useState<"csv" | "xlsx">("csv");
  const [exporting, setExporting] = useState(false);
  const [currentUser, setCurrentUser] = useState<AuthUser | null>(null);

  useEffect(() => { getCurrentUser().then(setCurrentUser); }, []);

  const [filterOptions, setFilterOptions] = useState<{
    cities: string[]; countries: string[]; categories: string[];
  }>({ cities: [], countries: [], categories: [] });

  // Search selector state
  const [searches, setSearches] = useState<SearchType[]>([]);
  const [activeSearchId, setActiveSearchId] = useState<string>(urlSearchId);

  // Debounce free-text search
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(searchQuery), 400);
    return () => clearTimeout(timer);
  }, [searchQuery]);

  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { setCurrentPage(1); }, [debouncedSearch, filterCity, filterCountry, filterCategory, activeSearchId]);

  // Load search list for the dropdown
  useEffect(() => {
    api.get<{ searches: SearchType[] }>("/search", { limit: 100 })
      .then((data) => {
        const list = data.searches || [];
        setSearches(list);
        // If no active search selected, auto-select the latest completed one
        if (!activeSearchId && list.length > 0) {
          const latest = list.find((s: SearchType) => s.status === "completed" || s.status === "partially_completed") || list[0];
          setActiveSearchId(latest.id);
        }
      })
      .catch(() => {});
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const fetchLeads = useCallback(async () => {
    setLoading(true);
    try {
      const data = await api.get<{ leads: Lead[]; total: number; totalPages: number }>("/leads", {
        search_id: activeSearchId,
        search: debouncedSearch,
        city: filterCity,
        country: filterCountry,
        category: filterCategory,
        page: currentPage,
        limit: LEADS_PER_PAGE,
      });
      setLeads(data.leads);
      setTotal(data.total);
      setTotalPages(data.totalPages);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load leads");
    } finally {
      setLoading(false);
    }
  }, [debouncedSearch, filterCity, filterCountry, filterCategory, currentPage, activeSearchId]);

  const fetchFilterOptions = useCallback(async () => {
    try {
      const data = await api.get<{ leads: Lead[] }>("/leads", {
        search_id: activeSearchId,
        limit: 500,
      });
      const rows: Lead[] = data.leads || [];
      setFilterOptions({
        cities: Array.from(new Set(rows.map((l) => l.city).filter(Boolean))).sort() as string[],
        countries: Array.from(new Set(rows.map((l) => l.country).filter(Boolean))).sort() as string[],
        categories: Array.from(new Set(rows.map((l) => l.category).filter(Boolean))).sort() as string[],
      });
    } catch { /* Non-critical */ }
  }, [activeSearchId]);

  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { fetchLeads(); }, [fetchLeads]);
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { fetchFilterOptions(); }, [fetchFilterOptions]);

  // Clear selection when data changes
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { setSelectedIds(new Set()); }, [leads]);

  const allPageSelected = leads.length > 0 && leads.every((l) => selectedIds.has(l.id));

  const toggleSelectAll = useCallback(() => {
    setSelectedIds(allPageSelected ? new Set() : new Set(leads.map((l) => l.id)));
  }, [allPageSelected, leads]);

  const toggleSelectOne = useCallback((id: string) => {
    setSelectedIds((prev) => { const next = new Set(prev); if (next.has(id)) next.delete(id); else next.add(id); return next; });
  }, []);

  const handleDelete = useCallback((leadId: string) => { setLeadToDelete(leadId); setDeleteDialogOpen(true); }, []);

  const confirmDelete = useCallback(async () => {
    if (!leadToDelete) return;
    try {
      await api.del(`/leads/${leadToDelete}`);
      setLeadToDelete(null); setDeleteDialogOpen(false);
      fetchLeads();
    } catch (e) {
      setDeleteDialogOpen(false);
      setError(e instanceof Error ? e.message : "Failed to delete lead");
    }
  }, [leadToDelete, fetchLeads]);

  const handleDeleteAll = useCallback(async () => {
    setDeleting(true);
    try {
      await api.del("/leads");
      await api.del("/search");
      setDeleteAllOpen(false);
      setActiveSearchId("");
      setSearches([]);
      fetchLeads();
    } catch (e) {
      setDeleteAllOpen(false);
      setError(e instanceof Error ? e.message : "Failed to delete all data");
    }
    finally { setDeleting(false); }
  }, [fetchLeads]);

  const handleExport = useCallback(async (mode: "selected" | "all") => {
    setExporting(true);
    try {
      let leadIds: string[];
      if (mode === "selected") {
        leadIds = Array.from(selectedIds);
      } else {
        // Fetch ALL matching leads (paginated to handle >200)
        const allIds: string[] = [];
        let page = 1;
        const perPage = 500;
        while (true) {
          const data = await api.get<{ leads: Lead[]; total: number }>("/leads", {
            search_id: activeSearchId,
            search: debouncedSearch,
            city: filterCity,
            country: filterCountry,
            category: filterCategory,
            page,
            limit: perPage,
          }).catch(() => null);
          if (!data) break;
          const rows: Lead[] = data.leads || [];
          allIds.push(...rows.map((l) => l.id));
          if (rows.length < perPage || allIds.length >= data.total) break;
          page++;
        }
        leadIds = allIds;
      }
      if (leadIds.length === 0) return;
      await downloadPost("/export", { leadIds, format: exportFormat }, `leads-export.${exportFormat}`);
    } catch { /* show error */ }
    finally { setExporting(false); }
  }, [selectedIds, exportFormat, activeSearchId, debouncedSearch, filterCity, filterCountry, filterCategory]);

  const clearFilters = useCallback(() => {
    setSearchQuery(""); setFilterCity(""); setFilterCountry(""); setFilterCategory(""); setCurrentPage(1);
  }, []);

  const hasActiveFilters = searchQuery || filterCity || filterCountry || filterCategory;

  const activeSearch = searches.find((s) => s.id === activeSearchId);

  const filteredCountLabel = useMemo(
    () => `${total} lead${total !== 1 ? "s" : ""} found${hasActiveFilters ? " (filtered)" : ""}`,
    [total, hasActiveFilters]
  );

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">CRM</h1>
          <p className="text-sm text-muted-foreground">
            {activeSearch
              ? `Showing leads from: "${activeSearch.keyword}" (${activeSearch.city || activeSearch.country}) — ${formatDateShort(activeSearch.created_at)}`
              : "Select a search above to view its leads."}
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <Select value={exportFormat} onValueChange={(v) => setExportFormat(v as "csv" | "xlsx")}>
            <SelectTrigger className="w-[100px] h-9"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="csv">CSV</SelectItem>
              <SelectItem value="xlsx">XLSX</SelectItem>
            </SelectContent>
          </Select>
          <Button variant="outline" size="sm" className="gap-2" disabled={selectedIds.size === 0 || exporting} onClick={() => handleExport("selected")}>
            <Download className="h-4 w-4" /> Export Selected ({selectedIds.size})
          </Button>
          <Button variant="outline" size="sm" className="gap-2" disabled={exporting} onClick={() => handleExport("all")}>
            <Download className="h-4 w-4" /> Export All
          </Button>
          {currentUser?.role === "admin" && (
            <Button variant="destructive" size="sm" className="gap-2" onClick={() => setDeleteAllOpen(true)}>
              <Trash2 className="h-4 w-4" /> Delete All
            </Button>
          )}
        </div>
      </div>

      {error && (
        <div className="flex items-center gap-2 rounded-lg border border-destructive/50 bg-destructive/10 p-3 text-sm text-destructive">
          <AlertCircle className="h-4 w-4 shrink-0" /><span>{error}</span>
        </div>
      )}

      {/* Search Selector */}
      {searches.length > 0 && (
        <Card>
          <CardContent className="p-4">
            <div className="flex flex-col gap-3">
              <div>
                <Label className="text-xs text-muted-foreground mb-1 block">Filter by Search</Label>
                <Select
                  value={activeSearchId || "_all"}
                  onValueChange={(v) => {
                    setActiveSearchId(v === "_all" ? "" : v);
                    if (v !== "_all") router.push(`/crm?search_id=${v}`, { scroll: false });
                    else router.push("/crm", { scroll: false });
                  }}
                >
                  <SelectTrigger className="h-9">
                    <SelectValue placeholder="Select a search..." />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="_all">All Searches (Global)</SelectItem>
                    {searches.map((s) => (
                      <SelectItem key={s.id} value={s.id}>
                        {s.keyword} — {s.city || s.country} ({s.enriched_count}/{s.requested_count} leads) — {formatDateShort(s.created_at)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {/* Filters */}
              <div className="flex items-center gap-2">
                <div className="relative flex-1">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                  <Input placeholder="Search by name, email, or phone..." value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} className="pl-9" />
                </div>
                {hasActiveFilters && (
                  <Button variant="ghost" size="sm" onClick={clearFilters} className="gap-1 shrink-0">
                    <X className="h-3 w-3" /> Clear
                  </Button>
                )}
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                <div>
                  <Label className="text-xs text-muted-foreground mb-1 block">City</Label>
                  <Select value={filterCity || "_all"} onValueChange={(v) => setFilterCity(v === "_all" ? "" : v)}>
                    <SelectTrigger className="h-9"><SelectValue placeholder="All Cities" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="_all">All Cities</SelectItem>
                      {filterOptions.cities.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label className="text-xs text-muted-foreground mb-1 block">Country</Label>
                  <Select value={filterCountry || "_all"} onValueChange={(v) => setFilterCountry(v === "_all" ? "" : v)}>
                    <SelectTrigger className="h-9"><SelectValue placeholder="All Countries" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="_all">All Countries</SelectItem>
                      {filterOptions.countries.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label className="text-xs text-muted-foreground mb-1 block">Category</Label>
                  <Select value={filterCategory || "_all"} onValueChange={(v) => setFilterCategory(v === "_all" ? "" : v)}>
                    <SelectTrigger className="h-9"><SelectValue placeholder="All Categories" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="_all">All Categories</SelectItem>
                      {filterOptions.categories.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Lead Table */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Leads</CardTitle>
          <CardDescription>{filteredCountLabel}</CardDescription>
        </CardHeader>
            <CardContent className="p-0">
              {loading ? (
                <div className="flex items-center justify-center py-16"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
              ) : (
                <>
                  {/* Desktop Table */}
                  <div className="hidden md:block overflow-x-auto">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead className="w-10">
                            <button onClick={toggleSelectAll} className="flex items-center">
                              {allPageSelected ? <CheckSquare className="h-4 w-4" /> : <Square className="h-4 w-4" />}
                            </button>
                          </TableHead>
                          <TableHead>Business Name</TableHead>
                          <TableHead>Phone</TableHead>
                          <TableHead>Email</TableHead>
                          <TableHead className="hidden lg:table-cell">Website</TableHead>
                          <TableHead className="hidden lg:table-cell">Socials</TableHead>
                          <TableHead className="hidden lg:table-cell">City</TableHead>
                          <TableHead className="text-right">Actions</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {leads.length === 0 ? (
                          <TableRow>
                            <TableCell colSpan={8} className="text-center py-12">
                              <div className="flex flex-col items-center gap-2 text-muted-foreground">
                                <Users className="h-8 w-8" />
                                <p className="text-sm">No leads found</p>
                                {!activeSearchId && (
                                  <Link href="/search/new"><Button variant="outline" size="sm" className="gap-2 mt-2"><Search className="h-3 w-3" /> Start a Search</Button></Link>
                                )}
                                {hasActiveFilters && <Button variant="ghost" size="sm" onClick={clearFilters}>Clear filters</Button>}
                              </div>
                            </TableCell>
                          </TableRow>
                        ) : (
                          leads.map((lead) => (
                            <TableRow key={lead.id}>
                              <TableCell>
                                <button onClick={() => toggleSelectOne(lead.id)} className="flex items-center">
                                  {selectedIds.has(lead.id) ? <CheckSquare className="h-4 w-4" /> : <Square className="h-4 w-4" />}
                                </button>
                              </TableCell>
                              <TableCell>
                                <Link href={`/crm/${lead.id}`} className="font-medium text-sm hover:underline">{lead.business_name}</Link>
                                {lead.contact_person && <p className="text-xs text-muted-foreground">{lead.contact_person}</p>}
                              </TableCell>
                              <TableCell className="text-sm">{lead.phone || "\u2014"}</TableCell>
                              <TableCell className="text-sm truncate max-w-[180px]">{lead.email || "\u2014"}</TableCell>
                              <TableCell className="hidden lg:table-cell text-sm truncate max-w-[160px]">
                                {lead.website ? <a href={lead.website} target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:underline dark:text-blue-400">{lead.website.replace(/^https?:\/\//, "")}</a> : "\u2014"}
                              </TableCell>
                              <TableCell className="hidden lg:table-cell">
                                <div className="flex items-center gap-2">
                                  {lead.instagram ? (
                                    <a href={lead.instagram} target="_blank" rel="noopener noreferrer" title="Instagram" className="text-pink-600 hover:opacity-70">
                                      <AtSign className="h-4 w-4" />
                                    </a>
                                  ) : (
                                    <AtSign className="h-4 w-4 text-muted-foreground/30" />
                                  )}
                                  {lead.facebook ? (
                                    <a href={lead.facebook} target="_blank" rel="noopener noreferrer" title="Facebook" className="text-blue-600 hover:opacity-70">
                                      <ThumbsUp className="h-4 w-4" />
                                    </a>
                                  ) : (
                                    <ThumbsUp className="h-4 w-4 text-muted-foreground/30" />
                                  )}
                                  {lead.linkedin ? (
                                    <a href={lead.linkedin} target="_blank" rel="noopener noreferrer" title="LinkedIn" className="text-sky-700 hover:opacity-70">
                                      <Briefcase className="h-4 w-4" />
                                    </a>
                                  ) : (
                                    <Briefcase className="h-4 w-4 text-muted-foreground/30" />
                                  )}
                                </div>
                              </TableCell>
                              <TableCell className="hidden lg:table-cell text-sm">
                                {(() => {
                                  const mapUrl = lead.city ? getMapUrl(lead) : null;
                                  return mapUrl ? (
                                    <a
                                      href={mapUrl}
                                      target="_blank"
                                      rel="noopener noreferrer"
                                      title="Open location in Google Maps"
                                      className="flex items-center gap-1 text-sm text-blue-600 hover:underline dark:text-blue-400"
                                    >
                                      <MapPin className="h-3.5 w-3.5" />
                                      {lead.city}
                                    </a>
                                  ) : lead.city ? (
                                    <span className="flex items-center gap-1 text-sm">
                                      <MapPin className="h-3.5 w-3.5 text-muted-foreground" />
                                      {lead.city}
                                    </span>
                                  ) : (
                                    <span className="text-sm">{"\u2014"}</span>
                                  );
                                })()}
                              </TableCell>
                              <TableCell className="text-right">
                                <div className="flex items-center justify-end gap-1">
                                  <Link href={`/crm/${lead.id}`}><Button variant="ghost" size="sm" className="h-8 w-8 p-0"><Eye className="h-4 w-4" /></Button></Link>
                                  <Link href={`/crm/${lead.id}?edit=true`}><Button variant="ghost" size="sm" className="h-8 w-8 p-0"><Pencil className="h-4 w-4" /></Button></Link>
                                  <Button variant="ghost" size="sm" className="h-8 w-8 p-0 text-destructive hover:text-destructive" onClick={() => handleDelete(lead.id)}><Trash2 className="h-4 w-4" /></Button>
                                </div>
                              </TableCell>
                            </TableRow>
                          ))
                        )}
                      </TableBody>
                    </Table>
                  </div>
                  {/* Mobile Cards */}
                  <div className="md:hidden divide-y">
                    {leads.length === 0 ? (
                      <div className="flex flex-col items-center gap-2 text-muted-foreground py-12">
                        <Users className="h-8 w-8" /><p className="text-sm">No leads found</p>
                      </div>
                    ) : (
                      leads.map((lead) => (
                        <div key={lead.id} className="p-4 space-y-2">
                          <div className="flex items-start justify-between">
                            <div className="flex items-start gap-2">
                              <button onClick={() => toggleSelectOne(lead.id)} className="mt-0.5">
                                {selectedIds.has(lead.id) ? <CheckSquare className="h-4 w-4" /> : <Square className="h-4 w-4" />}
                              </button>
                              <div>
                                <Link href={`/crm/${lead.id}`} className="font-medium text-sm hover:underline block">{lead.business_name}</Link>
                                {lead.contact_person && <p className="text-xs text-muted-foreground">{lead.contact_person}</p>}
                              </div>
                            </div>
                          </div>
                          <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs text-muted-foreground pl-6">
                            {lead.phone && <span>Phone: {lead.phone}</span>}
                            {lead.email && <span className="truncate">Email: {lead.email}</span>}
                            {lead.city && (
                              <span className="flex items-center gap-1">
                                {getMapUrl(lead) ? (
                                  <a
                                    href={getMapUrl(lead)!}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    title="Open location in Google Maps"
                                    className="text-blue-600 hover:underline dark:text-blue-400"
                                  >
                                    <MapPin className="h-3 w-3" /> City: {lead.city}
                                  </a>
                                ) : (
                                  <span className="flex items-center gap-1">
                                    <MapPin className="h-3 w-3" /> City: {lead.city}
                                  </span>
                                )}
                              </span>
                            )}
                            {lead.country && <span>Country: {lead.country}</span>}
                          </div>
                          {(lead.instagram || lead.facebook || lead.linkedin) && (
                            <div className="flex items-center gap-2 pl-6">
                              {lead.instagram && (
                                <a href={lead.instagram} target="_blank" rel="noopener noreferrer" title="Instagram" className="text-pink-600 hover:opacity-70">
                                  <AtSign className="h-4 w-4" />
                                </a>
                              )}
                              {lead.facebook && (
                                <a href={lead.facebook} target="_blank" rel="noopener noreferrer" title="Facebook" className="text-blue-600 hover:opacity-70">
                                  <ThumbsUp className="h-4 w-4" />
                                </a>
                              )}
                              {lead.linkedin && (
                                <a href={lead.linkedin} target="_blank" rel="noopener noreferrer" title="LinkedIn" className="text-sky-700 hover:opacity-70">
                                  <Briefcase className="h-4 w-4" />
                                </a>
                              )}
                            </div>
                          )}
                          <div className="flex items-center gap-1 pl-6">
                            <Link href={`/crm/${lead.id}`}><Button variant="ghost" size="sm" className="h-7 px-2 text-xs gap-1"><Eye className="h-3 w-3" /> View</Button></Link>
                            <Link href={`/crm/${lead.id}?edit=true`}><Button variant="ghost" size="sm" className="h-7 px-2 text-xs gap-1"><Pencil className="h-3 w-3" /> Edit</Button></Link>
                            <Button variant="ghost" size="sm" className="h-7 px-2 text-xs gap-1 text-destructive hover:text-destructive" onClick={() => handleDelete(lead.id)}><Trash2 className="h-3 w-3" /> Delete</Button>
                          </div>
                        </div>
                      ))
                    )}
                  </div>
                  {/* Pagination */}
                  {totalPages > 1 && (
                    <div className="flex items-center justify-between border-t px-4 py-3">
                      <p className="text-xs text-muted-foreground">
                        Showing {(currentPage - 1) * LEADS_PER_PAGE + 1}\u2013{Math.min(currentPage * LEADS_PER_PAGE, total)} of {total}
                      </p>
                      <div className="flex items-center gap-1">
                        <Button variant="outline" size="sm" className="h-8 w-8 p-0" disabled={currentPage === 1} onClick={() => setCurrentPage((p) => p - 1)}><ChevronLeft className="h-4 w-4" /></Button>
                        {Array.from({ length: Math.min(totalPages, 5) }, (_, i) => {
                          let pageNum: number;
                          if (totalPages <= 5) pageNum = i + 1;
                          else if (currentPage <= 3) pageNum = i + 1;
                          else if (currentPage >= totalPages - 2) pageNum = totalPages - 4 + i;
                          else pageNum = currentPage - 2 + i;
                          return <Button key={pageNum} variant={currentPage === pageNum ? "default" : "outline"} size="sm" className="h-8 w-8 p-0 text-xs" onClick={() => setCurrentPage(pageNum)}>{pageNum}</Button>;
                        })}
                        <Button variant="outline" size="sm" className="h-8 w-8 p-0" disabled={currentPage === totalPages} onClick={() => setCurrentPage((p) => p + 1)}><ChevronRight className="h-4 w-4" /></Button>
                      </div>
                    </div>
                  )}
                </>
              )}
            </CardContent>
          </Card>

      {/* Delete Single Dialog */}
      <Dialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>Delete Lead</DialogTitle><DialogDescription>Are you sure? This cannot be undone.</DialogDescription></DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteDialogOpen(false)}>Cancel</Button>
            <Button variant="destructive" onClick={confirmDelete}>Delete</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete All Dialog */}
      <Dialog open={deleteAllOpen} onOpenChange={setDeleteAllOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete All Data</DialogTitle>
            <DialogDescription>This will permanently delete ALL search history and ALL leads from the CRM. This cannot be undone.</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteAllOpen(false)}>Cancel</Button>
            <Button variant="destructive" onClick={handleDeleteAll} disabled={deleting}>
              {deleting ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null} Delete Everything
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function formatDateShort(dateString: string): string {
  return new Date(dateString).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}
