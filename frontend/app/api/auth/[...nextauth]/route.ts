import NextAuth, { type NextAuthOptions } from "next-auth";
import GoogleProvider from "next-auth/providers/google";
import CredentialsProvider from "next-auth/providers/credentials";

const BACKEND_URL = process.env.BACKEND_URL || "http://localhost:8000";
const INTERNAL_API_KEY = process.env.INTERNAL_API_KEY || "";

const authOptions: NextAuthOptions = {
  providers: [
    GoogleProvider({
      clientId: process.env.GOOGLE_CLIENT_ID!,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
    }),
    CredentialsProvider({
      name: "Email",
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
      },
      async authorize(credentials) {
        if (!credentials?.email || !credentials?.password) return null;

        const res = await fetch(`${BACKEND_URL}/auth/login`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            email: credentials.email,
            password: credentials.password,
          }),
        });

        if (!res.ok) return null;

        const user = await res.json();
        return { id: user.id, email: user.email, name: user.name };
      },
    }),
  ],
  pages: {
    signIn: "/login",
  },
  cookies: {
    sessionToken: {
      name: process.env.NODE_ENV === "production" ? "__Secure-next-auth.session-token" : "next-auth.session-token",
      options: {
        httpOnly: true,
        sameSite: "lax",
        path: "/",
        secure: process.env.NODE_ENV === "production",
      },
    },
  },
  callbacks: {
    async signIn({ user, account }) {
      if (!user.email) return false;

      if (account?.provider === "google") {
        try {
          const res = await fetch(`${BACKEND_URL}/auth/upsert-user`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "X-Internal-API-Key": INTERNAL_API_KEY,
            },
            body: JSON.stringify({
              email: user.email,
              name: user.name,
              google_id: account.providerAccountId,
            }),
          });

          if (!res.ok) return false;

          const dbUser = await res.json();
          user.id = dbUser.id;
        } catch {
          return false;
        }
      }

      return true;
    },
    async jwt({ token, user }) {
      if (user) {
        token.id = user.id;
        token.email = user.email!;
      }
      return token;
    },
    async session({ session, token }) {
      session.user.id = token.id;
      session.user.email = token.email;
      return session;
    },
  },
};

const handler = NextAuth(authOptions);

export { handler as GET, handler as POST };
