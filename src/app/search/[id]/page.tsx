"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Loader2,
  Search,
  MapPin,
  Globe,
  Download,
  FileDown,
  Plus,
  RotateCcw,
  XCircle,
  ExternalLink,
  CheckCircle2,
  AlertCircle,
  Phone,
  Mail,
  Building2,
  Hash,
  Clock,
  StopCircle,
  AtSign,
  ThumbsUp,
  Briefcase,
  Bell,
} from "lucide-react";
import { getMapUrl } from "@/lib/utils";
import { BrandLoader } from "@/components/shared/brand-loader";
import { api, downloadPost, getCurrentUser, type AuthUser } from "@/lib/api";
import {
  isAlarmMuted,
  kickAudioIfNeeded,
  setAlarmMuted,
  startAlarm,
  stopAlarm,
} from "@/lib/alarm";

interface SearchData {
  search_id: string;
  status: string;
  discovered_count: number;
  enriched_count: number;
  requested_count: number;
  keyword: string;
  country: string;
  city: string | null;
  search_mode: string;
  error_message: string | null;
  created_at: string;
  updated_at: string;
  leads: LeadData[];
}

interface LeadData {
  id: string;
  business_name: string;
  contact_person: string | null;
  phone: string | null;
  phone_valid: boolean;
  email: string | null;
  website: string | null;
  instagram: string | null;
  facebook: string | null;
  linkedin: string | null;
  address: string | null;
  city: string | null;
  country: string | null;
  latitude: number | null;
  longitude: number | null;
  status: string;
  verified: boolean;
  confidence: string | null;
}

type ActiveStatus = "pending" | "discovering" | "enriching";

const isRunning = (status: string): status is ActiveStatus =>
  status === "pending" || status === "discovering" || status === "enriching";

const statusLabel: Record<string, string> = {
  pending: "Pending",
  discovering: "Discovering",
  enriching: "Enriching",
  completed: "Completed",
  partially_completed: "Partially Completed",
  failed: "Failed",
  cancelled: "Cancelled",
};

const statusVariant: Record<string, "default" | "success" | "warning" | "destructive" | "info" | "secondary"> = {
  pending: "info",
  discovering: "info",
  enriching: "warning",
  completed: "success",
  partially_completed: "warning",
  failed: "destructive",
  cancelled: "secondary",
};

const leadStatusVariant: Record<string, "default" | "secondary" | "success" | "warning" | "info" | "destructive"> = {
  new: "info",
  contacted: "secondary",
  interested: "success",
  follow_up: "warning",
  converted: "success",
  archived: "default",
};

export default function SearchResultsPage() {
  const params = useParams();
  const router = useRouter();
  const searchId = params.id as string;

  const [data, setData] = useState<SearchData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [cancelling, setCancelling] = useState(false);
  const [user, setUser] = useState<AuthUser | null>(null);
  const [logs, setLogs] = useState<string[]>([]);
  const logsEndRef = useRef<HTMLDivElement>(null);
  const prevStatusRef = useRef<string | null>(null);
  const [completeBanner, setCompleteBanner] = useState(false);
  const [alarmEnabled, setAlarmEnabledState] = useState<boolean>(() => !isAlarmMuted());
  const alarmEnabledRef = useRef(alarmEnabled);
  const alarmArmedRef = useRef(false);

  useEffect(() => {
    getCurrentUser().then(setUser);
  }, []);

  const isAdmin = user?.role === "admin";

  const fetchLogs = useCallback(async () => {
    // Live logs are admin-only; normal users are skipped (server also 401s).
    if (!isAdmin) return;
    try {
      const data = await api.get<{ logs: string[] }>("/logs", { search_id: searchId, tail: 30 });
      setLogs(data.logs || []);
    } catch { /* non-critical */ }
  }, [searchId, isAdmin]);

  const fetchSearchData = useCallback(async () => {
    try {
      const json = await api.get<SearchData>(`/search/${searchId}`);
      setData(json);
      setError(null);
      return json.status;
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error";
      setError(message);
      return null;
    } finally {
      setLoading(false);
    }
  }, [searchId]);

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    async function poll() {
      const status = await fetchSearchData();
      await fetchLogs();

      if (status) {
        const prev = prevStatusRef.current;
        prevStatusRef.current = status;
        // When a running search flips to "completed" (requested count reached),
        // show the completion banner and ring the alarm.
        if (prev && prev !== "completed" && isRunning(prev) && status === "completed") {
          setCompleteBanner(true);
          alarmArmedRef.current = true;
          if (alarmEnabledRef.current) {
            startAlarm();
          }
        }
      }

      // A transient fetch failure (flaky tunnel hop) must not kill the poll
      // loop: keep polling against the last known status so live updates
      // resume as soon as the connection recovers.
      const lastStatus = status ?? prevStatusRef.current;
      if (!cancelled && lastStatus && isRunning(lastStatus)) {
        timer = setTimeout(poll, status ? 3000 : 5000);
      }
    }

    poll();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [fetchSearchData, fetchLogs]);

  // Browsers block autoplay audio on some platforms; the alarm is re-triggered
  // on the user's first interaction (click/key) while it is meant to be audible.
  useEffect(() => {
    const onGesture = () => {
      if (completeBanner && alarmEnabledRef.current && alarmArmedRef.current) {
        kickAudioIfNeeded();
      }
    };
    window.addEventListener("pointerdown", onGesture);
    window.addEventListener("keydown", onGesture);
    return () => {
      window.removeEventListener("pointerdown", onGesture);
      window.removeEventListener("keydown", onGesture);
    };
  }, [completeBanner]);

  async function handleCancel() {
    if (!confirm("Are you sure you want to cancel this search?")) return;
    setCancelling(true);
    try {
      await api.post("/search/cancel", { searchId });
      await fetchSearchData();
    } catch {
      // silently fail, next poll will pick up the state
    } finally {
      setCancelling(false);
    }
  }

  async function handleExport(format: "csv" | "xlsx" | "pdf") {
    if (!data) return;
    try {
      await downloadPost(
        "/export",
        { leadIds: data.leads.map((l) => l.id), format },
        `leads-export-${searchId}.${format}`
      );
    } catch (err) {
      alert(err instanceof Error ? err.message : "Export failed");
    }
  }

  function toggleAlarmMute() {
    const next = !alarmEnabledRef.current;
    alarmEnabledRef.current = next;
    setAlarmEnabledState(next);
    setAlarmMuted(!next);
    if (!next) {
      stopAlarm();
    } else if (completeBanner && alarmArmedRef.current) {
      startAlarm();
      kickAudioIfNeeded();
    }
  }

  function dismissCompleteBanner() {
    setCompleteBanner(false);
    alarmArmedRef.current = false;
    stopAlarm();
  }

  if (loading) {
    return (
      <BrandLoader label="Loading search…" className="py-24" />
    );
  }

  if (error && !data) {
    return (
      <div className="flex flex-col items-center justify-center gap-4 py-24">
        <AlertCircle className="h-12 w-12 text-destructive" />
        <h2 className="text-xl font-semibold">Search Not Found</h2>
        <p className="text-muted-foreground text-sm">{error}</p>
        <Button variant="outline" onClick={() => router.push("/search-history")}>
          Back to History
        </Button>
      </div>
    );
  }

  if (!data) return null;

  const running = isRunning(data.status);
  const completed =
    data.status === "completed" || data.status === "partially_completed";
  const failed = data.status === "failed";
  const cancelled = data.status === "cancelled";
  const showStopReason =
    !!data.error_message && (data.status === "partially_completed" || cancelled);
  const discoveryPct = data.requested_count
    ? Math.min(100, Math.round((data.discovered_count / data.requested_count) * 100))
    : 0;
  const enrichmentPct = data.discovered_count
    ? Math.min(100, Math.round((data.enriched_count / data.discovered_count) * 100))
    : 0;

  return (
    <div className="space-y-6 max-w-6xl mx-auto">
      {/* Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Search Details</h1>
          <p className="text-muted-foreground text-sm mt-1">
            ID: <code className="text-xs bg-muted px-1.5 py-0.5 rounded">{searchId}</code>
          </p>
        </div>
        <Badge variant={statusVariant[data.status] ?? "secondary"} className="w-fit text-sm px-3 py-1">
          {statusLabel[data.status] ?? data.status}
        </Badge>
      </div>

      {/* Search Info Card */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <Search className="h-4 w-4 text-muted-foreground" />
            Search Information
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-4">
            <div className="space-y-1">
              <p className="text-xs text-muted-foreground">Keyword</p>
              <p className="font-medium text-sm">{data.keyword}</p>
            </div>
            <div className="space-y-1">
              <p className="text-xs text-muted-foreground flex items-center gap-1">
                <Globe className="h-3 w-3" /> Country
              </p>
              <p className="font-medium text-sm">{data.country}</p>
            </div>
            <div className="space-y-1">
              <p className="text-xs text-muted-foreground flex items-center gap-1">
                <MapPin className="h-3 w-3" /> City
              </p>
              <p className="font-medium text-sm">{data.city || "—"}</p>
            </div>
            <div className="space-y-1">
              <p className="text-xs text-muted-foreground">Mode</p>
              <p className="font-medium text-sm capitalize">{data.search_mode}</p>
            </div>
            <div className="space-y-1">
              <p className="text-xs text-muted-foreground flex items-center gap-1">
                <Hash className="h-3 w-3" /> Requested
              </p>
              <p className="font-medium text-sm">{data.requested_count}</p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Stop reason (why a partially_completed/cancelled search stopped short) */}
      {showStopReason && (
        <div className="flex items-start gap-2 rounded-lg border border-muted-foreground/20 bg-muted/40 p-3 text-sm">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
          <span className="text-muted-foreground">{data.error_message}</span>
        </div>
      )}

      {/* Progress Section */}
      {running && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <Loader2 className="h-4 w-4 animate-spin text-primary" />
              Progress
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-6">
            {/* Discovery Stage */}
            <div className="space-y-2">
              <div className="flex items-center justify-between text-sm">
                <span className="flex items-center gap-2 font-medium">
                  <Building2 className="h-4 w-4 text-muted-foreground" />
                  Stage 1: Discovering Businesses
                </span>
                <span className="text-muted-foreground">
                  {data.discovered_count} / {data.requested_count}
                </span>
              </div>
              <div className="h-3 w-full rounded-full bg-muted overflow-hidden">
                <div
                  className="h-full rounded-full bg-primary transition-all duration-500 ease-out"
                  style={{ width: `${discoveryPct}%` }}
                />
              </div>
              <p className="text-xs text-muted-foreground text-right">{discoveryPct}%</p>
            </div>

            {/* Enrichment Stage */}
            <div className="space-y-2">
              <div className="flex items-center justify-between text-sm">
                <span className="flex items-center gap-2 font-medium">
                  <CheckCircle2 className="h-4 w-4 text-muted-foreground" />
                  Stage 2: Enriching Leads
                </span>
                <span className="text-muted-foreground">
                  {data.enriched_count} / {data.discovered_count}
                </span>
              </div>
              <div className="h-3 w-full rounded-full bg-muted overflow-hidden">
                <div
                  className="h-full rounded-full bg-green-500 transition-all duration-500 ease-out"
                  style={{ width: `${enrichmentPct}%` }}
                />
              </div>
              <p className="text-xs text-muted-foreground text-right">{enrichmentPct}%</p>
            </div>

            {/* Current status + Cancel */}
            <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 pt-2 border-t">
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Clock className="h-4 w-4" />
                Current stage:{" "}
                <Badge variant={statusVariant[data.status] ?? "secondary"} className="ml-1">
                  {statusLabel[data.status]}
                </Badge>
              </div>
              <Button
                variant="destructive"
                size="sm"
                onClick={handleCancel}
                disabled={cancelling}
              >
                {cancelling ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <StopCircle className="mr-2 h-4 w-4" />
                )}
                Cancel Search
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Logs Section — admin only */}
      {isAdmin && (running || logs.length > 0) && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center gap-2">
              <Clock className="h-4 w-4 text-muted-foreground" />
              Live Logs
              {running && <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="bg-black text-green-400 rounded-lg p-4 font-mono text-xs max-h-[300px] overflow-y-auto">
              {logs.length === 0 ? (
                <p className="text-gray-500">Waiting for extraction to start...</p>
              ) : (
                logs.map((line, i) => (
                  <div key={i} className="whitespace-pre-wrap break-all leading-relaxed">
                    {line}
                  </div>
                ))
              )}
              <div ref={logsEndRef} />
            </div>
          </CardContent>
        </Card>
      )}

      {/* Results Section */}
      {(completed || data.leads.length > 0) && (
        <Card>
          <CardHeader className="pb-3">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <CardTitle className="text-base flex items-center gap-2">
                <CheckCircle2 className="h-4 w-4 text-green-600" />
                Results
                <span className="text-sm font-normal text-muted-foreground">
                  — {data.enriched_count} of {data.requested_count} verified leads ({data.leads.length} total found)
                </span>
              </CardTitle>
              <div className="flex items-center gap-2">
                <Button variant="outline" size="sm" onClick={() => handleExport("csv")}>
                  <Download className="mr-2 h-4 w-4" />
                  CSV
                </Button>
                <Button variant="outline" size="sm" onClick={() => handleExport("xlsx")}>
                  <Download className="mr-2 h-4 w-4" />
                  Excel
                </Button>
                <Button variant="outline" size="sm" onClick={() => handleExport("pdf")}>
                  <FileDown className="mr-2 h-4 w-4" />
                  PDF
                </Button>
                <Link href="/search/new">
                  <Button size="sm">
                    <Plus className="mr-2 h-4 w-4" />
                    New Search
                  </Button>
                </Link>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            {data.leads.length === 0 ? (
              <div className="text-center py-12 text-muted-foreground">
                <Building2 className="h-12 w-12 mx-auto mb-3 opacity-40" />
                <p className="text-sm">No leads found for this search.</p>
              </div>
            ) : (
              <>
                {/* Desktop Table */}
                <div className="hidden md:block">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Name</TableHead>
                        <TableHead>Phone</TableHead>
                        <TableHead>Email</TableHead>
                        <TableHead>Website</TableHead>
                        <TableHead className="hidden lg:table-cell">Socials</TableHead>
                        <TableHead>City</TableHead>
                        <TableHead>Verified</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead className="text-right">Action</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {data.leads.map((lead) => (
                        <TableRow key={lead.id}>
                          <TableCell className="font-medium max-w-[200px] truncate">
                            {lead.business_name}
                          </TableCell>
                          <TableCell>
                            {lead.phone ? (
                              <span className="flex items-center gap-1 text-sm">
                                <Phone className="h-3 w-3 text-muted-foreground" />
                                {lead.phone}
                              </span>
                            ) : (
                              <span className="text-muted-foreground text-xs">—</span>
                            )}
                          </TableCell>
                          <TableCell>
                            {lead.email ? (
                              <span className="flex items-center gap-1 text-sm">
                                <Mail className="h-3 w-3 text-muted-foreground" />
                                <span className="max-w-[180px] truncate inline-block">
                                  {lead.email}
                                </span>
                              </span>
                            ) : (
                              <span className="text-muted-foreground text-xs">—</span>
                            )}
                          </TableCell>
                          <TableCell>
                            {lead.website ? (
                              <a
                                href={lead.website}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="flex items-center gap-1 text-sm text-blue-600 hover:underline max-w-[160px] truncate"
                              >
                                <ExternalLink className="h-3 w-3 shrink-0" />
                                {lead.website.replace(/^https?:\/\//, "")}
                              </a>
                            ) : (
                              <span className="text-muted-foreground text-xs">—</span>
                            )}
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
                          <TableCell className="text-sm">
                            {(() => {
                              const mapUrl = getMapUrl(lead);
                              return mapUrl ? (
                                <a
                                  href={mapUrl}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="inline-flex items-center gap-1 text-blue-600 hover:underline dark:text-blue-400"
                                  title="Open location in Google Maps"
                                >
                                  <MapPin className="h-3.5 w-3.5 shrink-0" />
                                  {lead.city || "—"}
                                  <ExternalLink className="h-3 w-3 shrink-0" />
                                </a>
                              ) : (
                                <span className="inline-flex items-center gap-1">
                                  <MapPin className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                                  {lead.city || "—"}
                                </span>
                              );
                            })()}
                          </TableCell>
                          <TableCell>
                            {lead.verified ? (
                              <Badge variant="success" className="gap-1">
                                <CheckCircle2 className="h-3 w-3" /> Verified
                              </Badge>
                            ) : (
                              <Badge variant="secondary">Unverified</Badge>
                            )}
                          </TableCell>
                          <TableCell>
                            <Badge variant={leadStatusVariant[lead.status] ?? "secondary"}>
                              {lead.status}
                            </Badge>
                          </TableCell>
                          <TableCell className="text-right">
                            <Link href={`/crm/${lead.id}`}>
                              <Button variant="ghost" size="sm">
                                View
                              </Button>
                            </Link>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>

                {/* Mobile Cards */}
                <div className="md:hidden space-y-3">
                  {data.leads.map((lead) => (
                    <div key={lead.id} className="rounded-lg border p-4 space-y-2 hover:bg-muted/50 transition-colors">
                      <div className="flex items-start justify-between gap-2">
                        <Link
                          href={`/crm/${lead.id}`}
                          className="font-medium text-sm truncate min-w-0 hover:underline"
                          title="View lead details"
                        >
                          {lead.business_name}
                        </Link>
                        <div className="flex shrink-0 flex-wrap justify-end gap-1">
                          {lead.verified ? (
                            <Badge variant="success" className="text-xs">Verified</Badge>
                          ) : (
                            <Badge variant="secondary" className="text-xs">Unverified</Badge>
                          )}
                          <Badge
                            variant={leadStatusVariant[lead.status] ?? "secondary"}
                            className="text-xs"
                          >
                            {lead.status}
                          </Badge>
                        </div>
                      </div>
                        {lead.phone && (
                          <p className="flex items-center gap-1 text-sm text-muted-foreground">
                            <Phone className="h-3 w-3" /> {lead.phone}
                          </p>
                        )}
                        {lead.email && (
                          <p className="flex items-center gap-1 text-sm text-muted-foreground">
                            <Mail className="h-3 w-3" />{" "}
                            <span className="truncate">{lead.email}</span>
                          </p>
                        )}
                        {(lead.instagram || lead.facebook || lead.linkedin) && (
                          <div className="flex items-center gap-2 pt-1">
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
                        {(() => {
                            if (!lead.city) return null;
                            const mapUrl = getMapUrl(lead);
                            return mapUrl ? (
                              <a
                                href={mapUrl}
                                target="_blank"
                                rel="noopener noreferrer"
                                title="Open location in Google Maps"
                                className="flex items-center gap-1 text-sm text-blue-600 hover:underline dark:text-blue-400"
                              >
                                <MapPin className="h-3 w-3" />
                                {lead.city}
                                <ExternalLink className="h-3 w-3" />
                              </a>
                            ) : (
                              <p className="flex items-center gap-1 text-sm text-muted-foreground">
                                <MapPin className="h-3 w-3" />
                                {lead.city}
                              </p>
                            );
                          })()}
                      </div>
                  ))}
                </div>
              </>
            )}
          </CardContent>
        </Card>
      )}

      {/* Cancelled State */}
      {cancelled && (
        <Card>
          <CardContent className="py-8">
            <div className="flex flex-col items-center gap-4 text-center">
              <StopCircle className="h-12 w-12 text-muted-foreground" />
              <div className="space-y-1">
                <h3 className="font-semibold text-lg">Search Cancelled</h3>
                <p className="text-sm text-muted-foreground max-w-md">
                  You stopped this search before it finished. {data.enriched_count} verified lead(s) had already been found.
                </p>
              </div>
              <Link href="/search-history">
                <Button variant="secondary">
                  <XCircle className="mr-2 h-4 w-4" />
                  Back to History
                </Button>
              </Link>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Error State */}
      {failed && (
        <Card className="border-destructive/50">
          <CardContent className="py-8">
            <div className="flex flex-col items-center gap-4 text-center">
              <AlertCircle className="h-12 w-12 text-destructive" />
              <div className="space-y-1">
                <h3 className="font-semibold text-lg">Search Failed</h3>
                <p className="text-sm text-muted-foreground max-w-md">
                  {data.error_message || "An unexpected error occurred during the search."}
                </p>
              </div>
              <div className="flex items-center gap-3">
                <Link href={`/search/${searchId}`}>
                  <Button variant="outline" onClick={() => window.location.reload()}>
                    <RotateCcw className="mr-2 h-4 w-4" />
                    Retry
                  </Button>
                </Link>
                <Link href="/search-history">
                  <Button variant="secondary">
                    <XCircle className="mr-2 h-4 w-4" />
                    Back to History
                  </Button>
                </Link>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Completion alarm banner — rings until acknowledged so the operator
          immediately knows the requested lead count was reached. */}
      {completeBanner && data && (
        <div className="fixed bottom-4 right-4 z-50 w-[min(92vw,380px)] rounded-xl border-2 border-green-500 bg-green-50 dark:bg-green-950 shadow-lg">
          <div className="flex items-start gap-3 p-4">
            <CheckCircle2 className="mt-0.5 h-6 w-6 shrink-0 text-green-600" />
            <div className="flex-1 min-w-0">
              <h3 className="font-semibold text-sm text-green-700 dark:text-green-300">
                {data.status === "completed"
                  ? `Search complete — ${data.enriched_count}/${data.requested_count} verified leads!`
                  : `Search finished — ${data.enriched_count} verified leads found`}
              </h3>
              <p className="text-xs text-muted-foreground mt-0.5">
                “{data.keyword}” {data.status === "completed" ? "— requested count reached." : "— stopped short of the target."}
              </p>
              <div className="flex items-center gap-2 mt-3">
                <Button size="sm" variant="default" onClick={dismissCompleteBanner}>
                  Stop Alarm
                </Button>
                <Button size="sm" variant="outline" onClick={toggleAlarmMute}>
                  <Bell className="mr-1 h-3.5 w-3.5" />
                  {alarmEnabled ? "Mute" : "Unmute"}
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
