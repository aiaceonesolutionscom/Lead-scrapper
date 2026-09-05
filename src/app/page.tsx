"use client";

import { useEffect, useState } from "react";
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
import Link from "next/link";
import {
  Search,
  Users,
  BadgeCheck,
  ArrowRight,
  TrendingUp,
  Loader2,
  AlertCircle,
} from "lucide-react";
import type { Search as SearchType, Lead, DashboardStats } from "@/types";
import { api } from "@/lib/api";

function getStatusBadge(status: SearchType["status"]) {
  const variants: Record<
    SearchType["status"],
    { label: string; className: string }
  > = {
    pending: {
      label: "Pending",
      className: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400",
    },
    discovering: {
      label: "Discovering",
      className: "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400",
    },
    enriching: {
      label: "Enriching",
      className: "bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-400",
    },
    completed: {
      label: "Completed",
      className: "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400",
    },
    partially_completed: {
      label: "Partial",
      className: "bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-400",
    },
    failed: {
      label: "Failed",
      className: "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400",
    },
    cancelled: {
      label: "Cancelled",
      className: "bg-gray-100 text-gray-800 dark:bg-gray-800/50 dark:text-gray-400",
    },
  };

  const config = variants[status];
  return <Badge className={`text-xs font-medium ${config.className}`}>{config.label}</Badge>;
}

const EMPTY_STATS: DashboardStats = {
  total_searches: 0,
  total_leads: 0,
  verified_leads: 0,
  new_leads: 0,
  contacted_leads: 0,
  converted_leads: 0,
};

export default function DashboardPage() {
  const [stats, setStats] = useState<DashboardStats>(EMPTY_STATS);
  const [searches, setSearches] = useState<SearchType[]>([]);
  const [leads, setLeads] = useState<Lead[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const data = await api.get<{
          stats: DashboardStats;
          recent_searches: SearchType[];
          recent_leads: Lead[];
        }>("/dashboard");
        if (cancelled) return;
        setStats(data.stats);
        setSearches(data.recent_searches);
        setLeads(data.recent_leads);
        setError(null);
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Failed to load dashboard");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    load();
    return () => {
      cancelled = true;
    };
  }, []);

  const statCards = [
    {
      title: "Total Searches",
      value: stats.total_searches,
      icon: Search,
      color: "text-blue-600 dark:text-blue-400",
      bg: "bg-blue-50 dark:bg-blue-950/50",
    },
    {
      title: "Total Leads",
      value: stats.total_leads.toLocaleString(),
      icon: Users,
      color: "text-violet-600 dark:text-violet-400",
      bg: "bg-violet-50 dark:bg-violet-950/50",
    },
    {
      title: "Verified Leads",
      value: stats.verified_leads.toLocaleString(),
      icon: BadgeCheck,
      color: "text-green-600 dark:text-green-400",
      bg: "bg-green-50 dark:bg-green-950/50",
    },
  ];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Dashboard</h1>
          <p className="text-sm text-muted-foreground">
            Overview of your lead extraction and CRM activity.
          </p>
        </div>
        <Link href="/search/new">
          <Button className="gap-2">
            <TrendingUp className="h-4 w-4" />
            New Search
          </Button>
        </Link>
      </div>

      {error && (
        <div className="flex items-center gap-2 rounded-lg border border-destructive/50 bg-destructive/10 p-3 text-sm text-destructive">
          <AlertCircle className="h-4 w-4 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {loading ? (
        <div className="flex items-center justify-center py-24">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </div>
      ) : (
        <>
          {/* Stats Grid */}
          <div className="grid gap-4 grid-cols-2 md:grid-cols-3">
            {statCards.map((card) => (
              <Card key={card.title}>
                <CardContent className="p-4">
                  <div className="flex items-center justify-between">
                    <div className={`rounded-lg p-2 ${card.bg}`}>
                      <card.icon className={`h-4 w-4 ${card.color}`} />
                    </div>
                  </div>
                  <div className="mt-3">
                    <p className="text-2xl font-bold">{card.value}</p>
                    <p className="text-xs text-muted-foreground">{card.title}</p>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>

          <div className="grid gap-6 lg:grid-cols-2">
            {/* Recent Searches */}
            <Card>
              <CardHeader className="flex flex-row items-center justify-between pb-2">
                <CardTitle className="text-base font-semibold">Recent Searches</CardTitle>
                <Link href="/search-history">
                  <Button variant="ghost" size="sm" className="gap-1 text-xs">
                    View All <ArrowRight className="h-3 w-3" />
                  </Button>
                </Link>
              </CardHeader>
              <CardContent>
                {searches.length === 0 ? (
                  <p className="text-sm text-muted-foreground py-8 text-center">
                    No searches yet.
                  </p>
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="text-xs">Keyword</TableHead>
                        <TableHead className="text-xs hidden sm:table-cell">Location</TableHead>
                        <TableHead className="text-xs hidden md:table-cell">Leads</TableHead>
                        <TableHead className="text-xs">Status</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {searches.map((search) => (
                        <TableRow key={search.id}>
                          <TableCell className="font-medium text-sm py-2.5">
                            <Link href={`/search/${search.id}`} className="flex flex-col hover:underline">
                              <span>{search.keyword}</span>
                              <span className="text-xs text-muted-foreground sm:hidden">
                                {search.city ? `${search.city}, ` : ""}
                                {search.country}
                              </span>
                            </Link>
                          </TableCell>
                          <TableCell className="hidden sm:table-cell text-sm text-muted-foreground py-2.5">
                            {search.city ? `${search.city}, ` : ""}
                            {search.country}
                          </TableCell>
                          <TableCell className="hidden md:table-cell py-2.5">
                            <span className="text-sm">
                              {search.enriched_count}
                              <span className="text-muted-foreground">
                                /{search.requested_count}
                              </span>
                            </span>
                          </TableCell>
                          <TableCell className="py-2.5">
                            {getStatusBadge(search.status)}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
              </CardContent>
            </Card>

            {/* Recent Leads */}
            <Card>
              <CardHeader className="flex flex-row items-center justify-between pb-2">
                <CardTitle className="text-base font-semibold">Recent Leads</CardTitle>
                <Link href="/crm">
                  <Button variant="ghost" size="sm" className="gap-1 text-xs">
                    View All <ArrowRight className="h-3 w-3" />
                  </Button>
                </Link>
              </CardHeader>
              <CardContent>
                {leads.length === 0 ? (
                  <p className="text-sm text-muted-foreground py-8 text-center">
                    No leads yet.
                  </p>
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="text-xs">Business</TableHead>
                        <TableHead className="text-xs hidden sm:table-cell">Contact</TableHead>
                        <TableHead className="text-xs hidden md:table-cell">Location</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {leads.map((lead) => (
                        <TableRow key={lead.id}>
                          <TableCell className="font-medium text-sm py-2.5">
                            <Link href={`/crm/${lead.id}`} className="flex flex-col hover:underline">
                              <span className="truncate max-w-[160px]">{lead.business_name}</span>
                              <span className="text-xs text-muted-foreground truncate max-w-[160px] sm:hidden">
                                {lead.contact_person || lead.email || "No contact"}
                              </span>
                            </Link>
                          </TableCell>
                          <TableCell className="hidden sm:table-cell text-sm text-muted-foreground py-2.5">
                            {lead.contact_person || "—"}
                          </TableCell>
                          <TableCell className="hidden md:table-cell text-sm text-muted-foreground py-2.5">
                            {lead.city ? `${lead.city}, ` : ""}
                            {lead.country || "—"}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
              </CardContent>
            </Card>
          </div>
        </>
      )}
    </div>
  );
}
