import { useState } from "react";
import { useLocation } from "wouter";
import { useLogin, useGetMe } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Heart } from "lucide-react";
import { motion } from "framer-motion";

export default function Login() {
  const [, setLocation] = useLocation();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");

  const { data: user } = useGetMe({
    query: {
      retry: false,
      queryKey: ["/api/auth/me"],
    },
  });

  if (user) {
    setLocation("/");
  }

  const loginMutation = useLogin({
    mutation: {
      onSuccess: () => {
        setLocation("/");
      },
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!username || !password) return;
    loginMutation.mutate({ data: { username, password } });
  };

  return (
    <div className="min-h-[100dvh] w-full flex items-center justify-center bg-background p-4 relative overflow-hidden">
      <div className="absolute top-[-10%] left-[-10%] w-[50%] h-[50%] rounded-full bg-primary/5 blur-[120px] pointer-events-none" />
      <div className="absolute bottom-[-10%] right-[-10%] w-[50%] h-[50%] rounded-full bg-accent/20 blur-[120px] pointer-events-none" />

      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.8, ease: "easeOut" }}
        className="w-full max-w-sm relative z-10"
      >
        <Card className="border-none shadow-xl shadow-primary/5 bg-card/80 backdrop-blur-sm">
          <CardHeader className="text-center pb-6">
            <div className="mx-auto w-12 h-12 bg-primary/10 rounded-full flex items-center justify-center mb-4 text-primary">
              <Heart className="w-6 h-6 fill-primary/20" />
            </div>
            <CardTitle className="text-2xl font-medium tracking-tight text-foreground">
              Chat {"<3"}
            </CardTitle>
            <CardDescription className="text-muted-foreground text-base mt-2">
              Aquí podremos hablar libremente
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit} className="space-y-5">
              <div className="space-y-2">
                <Label htmlFor="username" className="text-sm font-medium text-foreground/80">
                  ¿Quién eres?
                </Label>
                <div className="grid grid-cols-2 gap-3">
                  <Button
                    type="button"
                    variant={username === "marc" ? "default" : "outline"}
                    className={`h-12 text-base transition-all ${
                      username === "marc"
                        ? "bg-primary text-primary-foreground shadow-md shadow-primary/20"
                        : "bg-transparent hover:bg-primary/5"
                    }`}
                    onClick={() => setUsername("marc")}
                  >
                    Marc
                  </Button>
                  <Button
                    type="button"
                    variant={username === "miya" ? "default" : "outline"}
                    className={`h-12 text-base transition-all ${
                      username === "miya"
                        ? "bg-primary text-primary-foreground shadow-md shadow-primary/20"
                        : "bg-transparent hover:bg-primary/5"
                    }`}
                    onClick={() => setUsername("miya")}
                  >
                    Miya
                  </Button>
                </div>
              </div>
              <div className="space-y-2">
                <Label htmlFor="password" className="text-sm font-medium text-foreground/80">
                  Contraseña secreta
                </Label>
                <Input
                  id="password"
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="h-12 bg-background/50 border-border/50 focus-visible:ring-primary/30 text-center text-lg tracking-widest placeholder:text-muted-foreground/50"
                  placeholder="••••••••"
                  autoComplete="current-password"
                />
              </div>
              <Button
                type="submit"
                className="w-full h-12 text-base font-medium mt-2 shadow-lg shadow-primary/20 transition-transform active:scale-[0.98]"
                disabled={!username || !password || loginMutation.isPending}
              >
                {loginMutation.isPending ? "Entrando..." : "Entrar"}
              </Button>
              {loginMutation.isError && (
                <p className="text-sm text-destructive text-center mt-4">
                  Contraseña incorrecta.
                </p>
              )}
            </form>
          </CardContent>
        </Card>
      </motion.div>
    </div>
  );
}
