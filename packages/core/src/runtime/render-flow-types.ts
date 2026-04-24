import type { Locator } from "../model/types"

export type RenderBehavior = "relocate" | "preserve"

export type RenderOutcome = {
  currentPageNumber?: number
  locator?: Locator
}
