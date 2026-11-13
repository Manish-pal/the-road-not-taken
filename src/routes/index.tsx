import { createFileRoute } from "@tanstack/react-router";
import { RoadApp } from "@/components/road-app";

export const Route = createFileRoute("/")({ component: RoadApp });
