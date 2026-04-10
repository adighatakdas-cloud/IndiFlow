export function requireLabAuth(request: Request): boolean {
  const authHeader = request.headers.get("authorization");
  return authHeader === `Bearer ${process.env.LAB_API_SECRET}`;
}
