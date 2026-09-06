"use client";

import { useEffect, useState, useCallback } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { BrandLoader } from "@/components/shared/brand-loader";
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
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import Link from "next/link";
import {
  Search,
  Eye,
  Calendar,
  MapPin,
  History,
  AlertCircle,
  ArrowUpDown,
  Loader2,
  FileSearch,
  Trash2,
} from "lucide-react";
import { getCurrentUser, type AuthUser } from "@/lib/api";
import type { Search as SearchType } from "@/types";
import { api } from "@/lib/api";

function formatDate(dateString: string): string {
  const date = new Date(dateString);
  return date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function formatTime(dateString: string): string {
  const date = new Date(dateString);
  return date.toLocaleTimeString("en-US", {
    hour: "2-digit",
    minute: "2-digit",
  });
}

function getStatusBadge(status: SearchType["status"]) {
  const variants: Record<
    SearchType["status"],
    { label: string; className: string; icon: React.ReactNode }
  > = {
    pending: {
      label: "Pending",
      className: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400",
      icon: <ArrowUpDown className="h-3 w-3" />,
    },
    discovering: {
      label: "Discovering",
      className: "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400",
      icon: <Search className="h-3 w-3" />,
    },
    enriching: {
      label: "Enriching",
      className: "bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-400",
      icon: <Loader2 className="h-3 w-3" />,
    },
    completed: {
      label: "Completed",
      className: "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400",
      icon: null,
    },
    partially_completed: {
      label: "Partial",
      className: "bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-400",
      icon: null,
    },
    failed: {
      label: "Failed",
      className: "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400",
      icon: <AlertCircle className="h-3 w-3" />,
    },
    cancelled: {
      label: "Cancelled",
      className: "bg-gray-100 text-gray-800 dark:bg-gray-800/50 dark:text-gray-400",
      icon: null,
    },
  };

  const config = variants[status];
  return (
    <Badge className={`text-xs font-medium gap-1 ${config.className}`}>
      {config.icon}
      {config.label}
    </Badge>
  );
}

export default function SearchHistoryPage() {
  const [searches, setSearches] = useState<SearchType[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<SearchType | null>(null);
  const [deleteAllOpen, setDeleteAllOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [user, setUser] = useState<AuthUser | null>(null);

  useEffect(() => {
    getCurrentUser().then(setUser);
  }, []);

  const isAdmin = user?.role === "admin";

  const loadSearches = useCallback(async () => {
    try {
      const data = await api.get<{ searches: SearchType[] }>("/search", { limit: 100 });
      setSearches(data.searches);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load");
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      await loadSearches();
      if (!cancelled) setIsLoading(false);
    })();
    return () => { cancelled = true; };
  }, [loadSearches]);

  const handleDelete = async (id: string) => {
    setDeleting(true);
    try {
      await api.del(`/search/${id}`);
      setDeleteTarget(null);
      await loadSearches();
    } catch {
      setError("Failed to delete search");
    } finally {
      setDeleting(false);
    }
  };

  const handleDeleteAll = async () => {
    setDeleting(true);
    try {
      await api.del("/search");
      await api.del("/leads");
      setDeleteAllOpen(false);
      await loadSearches();
    } catch {
      setError("Failed to delete all data");
    } finally {
      setDeleting(false);
    }
  };

  const totalSearches = searches.length;
  const completedSearches = searches.filter((s) => s.status === "completed").length;
  const totalLeads = searches.reduce((sum, s) => sum + s.enriched_count, 0);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
            <History className="h-6 w-6 text-muted-foreground" />
            Search History
          </h1>
          <p className="text-sm text-muted-foreground">
            View and manage all your lead extraction searches.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {searches.length > 0 && isAdmin && (
            <Button variant="destructive" className="gap-2" onClick={() => setDeleteAllOpen(true)}>
              <Trash2 className="h-4 w-4" />
              Delete All
            </Button>
          )}
          <Link href="/search/new">
            <Button className="gap-2">
              <FileSearch className="h-4 w-4" />
              New Search
            </Button>
          </Link>
        </div>
      </div>

      {error && (
        <div className="flex items-center gap-2 rounded-lg border border-destructive/50 bg-destructive/10 p-3 text-sm text-destructive">
          <AlertCircle className="h-4 w-4 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {/* Summary Stats */}
      <div className="grid gap-4 grid-cols-1 sm:grid-cols-3">
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              <div className="rounded-lg bg-blue-50 p-2 dark:bg-blue-950/50">
                <Search className="h-4 w-4 text-blue-600 dark:text-blue-400" />
              </div>
              <div>
                <p className="text-2xl font-bold">{totalSearches}</p>
                <p className="text-xs text-muted-foreground">Total Searches</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              <div className="rounded-lg bg-green-50 p-2 dark:bg-green-950/50">
                <FileSearch className="h-4 w-4 text-green-600 dark:text-green-400" />
              </div>
              <div>
                <p className="text-2xl font-bold">{completedSearches}</p>
                <p className="text-xs text-muted-foreground">Completed</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              <div className="rounded-lg bg-violet-50 p-2 dark:bg-violet-950/50">
                <MapPin className="h-4 w-4 text-violet-600 dark:text-violet-400" />
              </div>
              <div>
                <p className="text-2xl font-bold">{totalLeads.toLocaleString()}</p>
                <p className="text-xs text-muted-foreground">Leads Found</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Search History Table */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base font-semibold">All Searches</CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <BrandLoader label="Loading search history…" className="py-12" />
          ) : searches.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-center">
              <div className="rounded-full bg-muted p-3 mb-4">
                <Search className="h-6 w-6 text-muted-foreground" />
              </div>
              <h3 className="text-lg font-semibold mb-1">No searches yet</h3>
              <p className="text-sm text-muted-foreground mb-4 max-w-sm">
                Start your first lead extraction search to see results here.
              </p>
              <Link href="/search/new">
                <Button className="gap-2">
                  <FileSearch className="h-4 w-4" />
                  Start a Search
                </Button>
              </Link>
            </div>
          ) : (
            <>
              {/* Desktop Table */}
              <div className="hidden md:block">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="text-xs">Keyword</TableHead>
                      <TableHead className="text-xs">Location</TableHead>
                      <TableHead className="text-xs text-center">Requested / Found</TableHead>
                      <TableHead className="text-xs">Status</TableHead>
                      <TableHead className="text-xs">Date</TableHead>
                      <TableHead className="text-xs text-right">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {searches.map((search) => (
                      <TableRow key={search.id}>
                        <TableCell className="font-medium text-sm py-2.5">
                          <div className="flex items-center gap-2">
                            <Search className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                            <span className="truncate max-w-[200px]">{search.keyword}</span>
                          </div>
                        </TableCell>
                        <TableCell className="text-sm text-muted-foreground py-2.5">
                          <div className="flex items-center gap-1.5">
                            <MapPin className="h-3 w-3 shrink-0" />
                            <span className="truncate max-w-[160px]">
                              {search.city ? `${search.city}, ` : ""}
                              {search.country}
                            </span>
                          </div>
                        </TableCell>
                        <TableCell className="text-sm py-2.5 text-center">
                          <span className="font-medium">{search.enriched_count}</span>
                          <span className="text-muted-foreground"> / {search.requested_count}</span>
                        </TableCell>
                        <TableCell className="py-2.5">{getStatusBadge(search.status)}</TableCell>
                        <TableCell className="text-sm text-muted-foreground py-2.5 whitespace-nowrap">
                          <div className="flex flex-col">
                            <span>{formatDate(search.created_at)}</span>
                            <span className="text-xs">{formatTime(search.created_at)}</span>
                          </div>
                        </TableCell>
                        <TableCell className="py-2.5 text-right">
                          <div className="flex items-center justify-end gap-1.5">
                            <Link href={`/search/${search.id}`}>
                              <Button variant="outline" size="sm" className="gap-1.5">
                                <Eye className="h-3.5 w-3.5" />
                                View
                              </Button>
                            </Link>
                            {(isAdmin || search.created_by === user?.id) && (
                              <Button
                                variant="ghost"
                                size="sm"
                                className="text-destructive hover:text-destructive h-8 w-8 p-0"
                                onClick={() => setDeleteTarget(search)}
                              >
                                <Trash2 className="h-3.5 w-3.5" />
                              </Button>
                            )}
                          </div>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>

              {/* Mobile Cards */}
              <div className="md:hidden space-y-3">
                {searches.map((search) => (
                  <div key={search.id} className="rounded-lg border p-4 space-y-3">
                    <div className="flex items-start justify-between gap-2">
                      <div className="space-y-1 min-w-0">
                        <div className="font-medium text-sm flex items-center gap-2">
                          <Search className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                          <span className="truncate">{search.keyword}</span>
                        </div>
                        <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
                          <div className="flex items-center gap-1">
                            <MapPin className="h-3 w-3" />
                            {search.city ? `${search.city}, ` : ""}{search.country}
                          </div>
                          <div className="flex items-center gap-1">
                            <Calendar className="h-3 w-3" />
                            {formatDate(search.created_at)}
                          </div>
                        </div>
                      </div>
                      {getStatusBadge(search.status)}
                    </div>
                    <div className="flex items-center justify-between">
                      <div className="text-sm">
                        <span className="font-medium">{search.enriched_count}</span>
                        <span className="text-muted-foreground"> / {search.requested_count} leads</span>
                      </div>
                      <div className="flex gap-1.5">
                        <Link href={`/search/${search.id}`}>
                          <Button variant="outline" size="sm" className="gap-1.5">
                            <Eye className="h-3.5 w-3.5" />
                            View
                          </Button>
                        </Link>
                        {(isAdmin || search.created_by === user?.id) && (
                          <Button
                            variant="ghost"
                            size="sm"
                            className="text-destructive hover:text-destructive"
                            onClick={() => setDeleteTarget(search)}
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}
        </CardContent>
      </Card>

      {/* Delete Single Dialog */}
      <Dialog open={!!deleteTarget} onOpenChange={(open) => { if (!open) setDeleteTarget(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete Search</DialogTitle>
            <DialogDescription>
              Are you sure you want to delete the search &quot;{deleteTarget?.keyword}&quot;?
              This will remove the search record but keeps the leads in the CRM.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteTarget(null)}>Cancel</Button>
            <Button
              variant="destructive"
              onClick={() => deleteTarget && handleDelete(deleteTarget.id)}
              disabled={deleting}
            >
              {deleting ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete All Dialog */}
      <Dialog open={deleteAllOpen} onOpenChange={setDeleteAllOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete All Data</DialogTitle>
            <DialogDescription>
              This will permanently delete ALL search history and ALL leads from the CRM.
              This action cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteAllOpen(false)}>Cancel</Button>
            <Button
              variant="destructive"
              onClick={handleDeleteAll}
              disabled={deleting}
            >
              {deleting ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
              Delete Everything
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
