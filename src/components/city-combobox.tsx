"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { MapPin, Search, Check } from "lucide-react";
import { Input } from "@/components/ui/input";
import { citiesForCountry } from "@/lib/utils/cities";

interface CityComboboxProps {
  country?: string;
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  placeholder?: string;
}

function normalizeCity(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9\s]/g, "").replace(/\s+/g, " ").trim();
}

export function CityCombobox({
  country,
  value,
  onChange,
  disabled,
  placeholder,
}: CityComboboxProps) {
  const [open, setOpen] = useState(false);
  const [highlight, setHighlight] = useState(0);
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const cityPool = useMemo(() => citiesForCountry(country), [country]);

  const suggestions = useMemo(() => {
    const query = normalizeCity(value);
    if (!query) {
      // No typed text yet: show the country's most prominent cities, capped.
      return cityPool.slice(0, 60);
    }
    const scored = cityPool
      .map((name) => {
        const normalized = normalizeCity(name);
        if (normalized === query) return { name, rank: 0 };
        if (normalized.startsWith(query)) return { name, rank: 1 };
        if (normalized.includes(query)) return { name, rank: 2 };
        return null;
      })
      .filter((x): x is { name: string; rank: number } => x !== null)
      .sort((a, b) => a.rank - b.rank || a.name.localeCompare(b.name));
    return scored.slice(0, 60).map((x) => x.name);
  }, [cityPool, value]);

  // If exactly one suggestion is an exact match, the user has already picked it.
  const hasExactMatch = suggestions.some((s) => normalizeCity(s) === normalizeCity(value));

  useEffect(() => setHighlight(0), [value, open]);

  useEffect(() => {
    if (!open) return;
    const onDocClick = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, [open]);

  return (
    <div ref={containerRef} className="relative">
      <Input
        ref={inputRef}
        id="city"
        placeholder={placeholder}
        value={value}
        disabled={disabled}
        onChange={(e) => {
          onChange(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown" && open) {
            e.preventDefault();
            setHighlight((h) => Math.min(h + 1, suggestions.length - 1));
          } else if (e.key === "ArrowUp" && open) {
            e.preventDefault();
            setHighlight((h) => Math.max(h - 1, 0));
          } else if (e.key === "Enter") {
            if (open && suggestions.length > 0) {
              const selected = suggestions[highlight];
              if (selected) {
                e.preventDefault();
                onChange(selected);
                setOpen(false);
              }
            }
          } else if (e.key === "Escape") {
            setOpen(false);
            inputRef.current?.blur();
          }
        }}
      />

      {open && suggestions.length > 0 && (
        <ul
          className="absolute z-50 mt-1 max-h-64 w-full overflow-y-auto rounded-md border bg-popover text-popover-foreground shadow-md"
          role="listbox"
        >
          {suggestions.map((city, i) => {
            const selected = i === highlight;
            const isPicked = normalizeCity(city) === normalizeCity(value);
            return (
              <li
                key={city}
                role="option"
                aria-selected={selected}
                onMouseEnter={() => setHighlight(i)}
                onMouseDown={(e) => {
                  e.preventDefault();
                  onChange(city);
                  setOpen(false);
                }}
                className={`flex cursor-pointer items-center gap-2 px-3 py-1.5 text-sm ${
                  selected ? "bg-accent text-accent-foreground" : ""
                }`}
              >
                <MapPin className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                <span className="flex-1">{city}</span>
                {isPicked && <Check className="h-3.5 w-3.5 text-primary" />}
              </li>
            );
          })}
        </ul>
      )}

      {open && suggestions.length === 0 && (
        <div className="absolute z-50 mt-1 w-full rounded-md border bg-popover p-2 text-xs text-muted-foreground shadow-md">
          {value.trim() ? (
            <>No matching city in the list for this country — your typed value will be used as-is.</>
          ) : (
            <>No city list available for this country — you can still type any city manually.</>
          )}
        </div>
      )}

      <div className="pointer-events-none absolute inset-y-0 right-3 flex items-center">
        {hasExactMatch ? (
          <Check className="h-4 w-4 text-primary" />
        ) : (
          <Search className="h-4 w-4 text-muted-foreground" />
        )}
      </div>
    </div>
  );
}