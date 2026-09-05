"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
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
import {
  Search,
  MapPin,
  Loader2,
  AlertCircle,
  Globe,
  Hash,
  ArrowLeft,
  Building2,
} from "lucide-react";
import { COUNTRIES } from "@/lib/utils/countries";
import { CityCombobox } from "@/components/city-combobox";
import { api } from "@/lib/api";

interface FormErrors {
  keyword?: string;
  country?: string;
  city?: string;
  requestedCount?: string;
}

export default function NewSearchPage() {
  const router = useRouter();

  const [keyword, setKeyword] = useState("");
  const [country, setCountry] = useState("");
  const [searchMode, setSearchMode] = useState<"city" | "country">("city");
  const [city, setCity] = useState("");
  const [requestedCount, setRequestedCount] = useState<number>(100);

  const [errors, setErrors] = useState<FormErrors>({});
  const [serverError, setServerError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  function validate(): FormErrors {
    const newErrors: FormErrors = {};

    if (!keyword.trim()) {
      newErrors.keyword = "Keyword or business category is required";
    }

    if (!country) {
      newErrors.country = "Country is required";
    }

    if (searchMode === "city" && !city.trim()) {
      newErrors.city = "City is required when searching a specific location";
    }

    if (!requestedCount || requestedCount < 1) {
      newErrors.requestedCount = "Must be at least 1 lead";
    } else if (requestedCount > 500) {
      newErrors.requestedCount = "Maximum 500 leads per search";
    }

    return newErrors;
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setServerError(null);

    const validationErrors = validate();
    setErrors(validationErrors);

    if (Object.keys(validationErrors).length > 0) {
      return;
    }

    setIsSubmitting(true);

    try {
      const data = await api.post<{ searchId: string }>("/search/start", {
        keyword: keyword.trim(),
        country,
        city: searchMode === "city" ? city.trim() : undefined,
        searchMode,
        requestedCount,
      });

      router.push(`/search/${data.searchId}`);
    } catch (err) {
      setServerError(
        err instanceof Error ? err.message : "Something went wrong. Please try again."
      );
    } finally {
      setIsSubmitting(false);
    }
  }

  function handleKeywordChange(e: React.ChangeEvent<HTMLInputElement>) {
    setKeyword(e.target.value);
    if (errors.keyword) {
      setErrors((prev) => ({ ...prev, keyword: undefined }));
    }
  }

  function handleCountryChange(value: string) {
    setCountry(value);
    if (errors.country) {
      setErrors((prev) => ({ ...prev, country: undefined }));
    }
  }

  function handleCityChange(value: string) {
    setCity(value);
    if (errors.city) {
      setErrors((prev) => ({ ...prev, city: undefined }));
    }
  }

  function handleCountChange(e: React.ChangeEvent<HTMLInputElement>) {
    const val = e.target.value === "" ? 0 : parseInt(e.target.value, 10);
    setRequestedCount(isNaN(val) ? 0 : val);
    if (errors.requestedCount) {
      setErrors((prev) => ({ ...prev, requestedCount: undefined }));
    }
  }

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div className="flex items-center gap-3">
        <Button
          variant="ghost"
          size="icon"
          className="h-9 w-9"
          onClick={() => router.back()}
        >
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <div>
          <h1 className="text-2xl font-bold tracking-tight">New Search</h1>
          <p className="text-sm text-muted-foreground">
            Extract business leads from any location worldwide.
          </p>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg">
            <Search className="h-5 w-5 text-primary" />
            Search Parameters
          </CardTitle>
          <CardDescription>
            Define your search criteria to find relevant business leads.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-5">
            {serverError && (
              <div className="flex items-start gap-2 rounded-lg border border-destructive/50 bg-destructive/10 p-3 text-sm text-destructive">
                <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
                <span>{serverError}</span>
              </div>
            )}

            <div className="space-y-2">
              <Label htmlFor="keyword" className="flex items-center gap-1.5">
                <Building2 className="h-3.5 w-3.5 text-muted-foreground" />
                Keyword / Business Category
              </Label>
              <Input
                id="keyword"
                placeholder='e.g. "Digital Marketing Agency", "Restaurant", "SaaS Company"'
                value={keyword}
                onChange={handleKeywordChange}
                disabled={isSubmitting}
              />
              {errors.keyword && (
                <p className="text-xs text-destructive">{errors.keyword}</p>
              )}
            </div>

            <div className="space-y-2">
              <Label className="flex items-center gap-1.5">
                <Globe className="h-3.5 w-3.5 text-muted-foreground" />
                Country
              </Label>
              <Select
                value={country}
                onValueChange={handleCountryChange}
                disabled={isSubmitting}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select a country" />
                </SelectTrigger>
                <SelectContent className="max-h-[280px] overflow-y-auto">
                  {COUNTRIES.map((c) => (
                    <SelectItem key={c} value={c}>
                      {c}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {errors.country && (
                <p className="text-xs text-destructive">{errors.country}</p>
              )}
            </div>

            <div className="space-y-3">
              <Label className="flex items-center gap-1.5">
                <MapPin className="h-3.5 w-3.5 text-muted-foreground" />
                Location Mode
              </Label>
              <div className="grid grid-cols-2 gap-3">
                <button
                  type="button"
                  disabled={isSubmitting}
                  onClick={() => setSearchMode("city")}
                  className={`flex items-center gap-2 rounded-lg border p-3 text-sm font-medium transition-colors ${
                    searchMode === "city"
                      ? "border-primary bg-primary/5 text-primary"
                      : "border-input text-muted-foreground hover:bg-muted"
                  }`}
                >
                  <MapPin className="h-4 w-4" />
                  Specific City
                </button>
                <button
                  type="button"
                  disabled={isSubmitting}
                  onClick={() => setSearchMode("country")}
                  className={`flex items-center gap-2 rounded-lg border p-3 text-sm font-medium transition-colors ${
                    searchMode === "country"
                      ? "border-primary bg-primary/5 text-primary"
                      : "border-input text-muted-foreground hover:bg-muted"
                  }`}
                >
                  <Globe className="h-4 w-4" />
                  Entire Country
                </button>
              </div>
            </div>

            {searchMode === "city" && (
              <div className="space-y-2 animate-in fade-in slide-in-from-top-1 duration-200">
                <Label htmlFor="city" className="flex items-center gap-1.5">
                  <MapPin className="h-3.5 w-3.5 text-muted-foreground" />
                  City
                </Label>
                <CityCombobox
                  country={country}
                  value={city}
                  onChange={handleCityChange}
                  disabled={isSubmitting}
                  placeholder={
                    country
                      ? 'Type a city — e.g. "Los Angeles", "New York"'
                      : 'Select a country first to see its cities'
                  }
                />
                <p className="text-xs text-muted-foreground">
                  Pick a city from the list or type any city manually — the
                  search stays inside exactly this one city.
                </p>
                {errors.city && (
                  <p className="text-xs text-destructive">{errors.city}</p>
                )}
              </div>
            )}

            <div className="space-y-2">
              <Label htmlFor="count" className="flex items-center gap-1.5">
                <Hash className="h-3.5 w-3.5 text-muted-foreground" />
                Number of Leads Required
              </Label>
              <Input
                id="count"
                type="number"
                min={1}
                max={500}
                value={requestedCount || ""}
                onChange={handleCountChange}
                disabled={isSubmitting}
              />
              <p className="text-xs text-muted-foreground">
                Between 1 and 500 leads. Larger counts take longer since this
                tool only uses free public data sources (OpenStreetMap + web
                search).
              </p>
              {errors.requestedCount && (
                <p className="text-xs text-destructive">
                  {errors.requestedCount}
                </p>
              )}
            </div>

            <div className="pt-2">
              <Button
                type="submit"
                className="w-full gap-2"
                size="lg"
                disabled={isSubmitting}
              >
                {isSubmitting ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Starting Search...
                  </>
                ) : (
                  <>
                    <Search className="h-4 w-4" />
                    Start Search
                  </>
                )}
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
