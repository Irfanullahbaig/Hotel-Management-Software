"use client";
import { Printer } from "lucide-react";
import { Button } from "./button";
export function PrintButton() {
  return <Button variant="secondary" className="no-print" onClick={() => window.print()}><Printer className="size-4" /> Print / save PDF</Button>;
}
