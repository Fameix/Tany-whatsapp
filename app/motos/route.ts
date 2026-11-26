import { NextRequest } from "next/server";
import { productTestEntryResponse } from "@/lib/admin/product-test-entry";
export function GET(request: NextRequest) { return productTestEntryResponse(request, "motos"); }
