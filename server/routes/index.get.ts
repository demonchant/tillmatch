import { defineEventHandler, sendRedirect } from "h3";

export default defineEventHandler((event) => sendRedirect(event, "/landing", 302));
