// src/pages/Login.tsx
import React, { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { useAuth } from "@/hooks/useAuth";
import { toast } from "@/hooks/use-toast";
import logo from "./logo.png";
import plogo from "./l.png";

export const Login: React.FC = () => {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState(""); // used only for auditor
  const [otp, setOtp] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [otpSent, setOtpSent] = useState(false);

  const { login, sendOtp, verifyOtp } = useAuth();

  // Only this email retains password login (auditor hardcoded)
  // Auditors now use OTP too
  const PASSWORD_AUDITORS = new Set<string>([]);

  const isAuditorEmail = PASSWORD_AUDITORS.has(email.trim().toLowerCase());

  const handleAuditorSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    setTimeout(() => {
      const success = login(email, password);
      if (success) {
        toast({
          title: "Login Successful",
          description: "Welcome to Audit @Premier Energies",
        });
      } else {
        toast({
          title: "Login Failed",
          description: "Invalid email or password",
          variant: "destructive",
        });
      }
      setIsLoading(false);
    }, 800);
  };

  const handleSendOtp = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    try {
      const ok = await sendOtp(email);
      if (ok) {
        setOtpSent(true);
        toast({
          title: "OTP sent",
          description:
            "Please check your mailbox for the 4-digit OTP (valid 5 minutes).",
        });
      } else {
        toast({
          title: "Unable to send OTP",
          description:
            "Your email may not be registered or server is unavailable.",
          variant: "destructive",
        });
      }
    } finally {
      setIsLoading(false);
    }
  };

  const handleVerifyOtp = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!otp.trim()) {
      toast({
        title: "Enter OTP",
        description: "Please enter the 4-digit OTP.",
        variant: "destructive",
      });
      return;
    }
    setIsLoading(true);
    try {
      const ok = await verifyOtp(email, otp);
      if (ok) {
        toast({
          title: "Login Successful",
          description: "Welcome to Audit @Premier Energies",
        });
      } else {
        toast({
          title: "Invalid or expired OTP",
          description: "Please request a new OTP and try again.",
          variant: "destructive",
        });
      }
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex flex-col bg-background">
      {/* Header (left & right logos like the sample) */}
      <header className="w-full p-4 flex justify-between items-center bg-white shadow-sm">
        <img src={logo} alt="Premier Energies" className="h-24 object-cover" />
        <img src={plogo} alt="" className="h-16 object-contain" />
      </header>

      {/* Main */}
      <div className="flex-grow flex items-center justify-center p-6">
        <div className="max-w-md w-full bg-card rounded-lg shadow-lg p-8">
          <h2 className="text-2xl font-bold mb-6 text-center">Login</h2>

          {/* Email (shared) */}
          <div className="space-y-2 mb-4">
            <Label htmlFor="email">Email</Label>
            <Input
              id="email"
              type="email"
              placeholder="Enter your email"
              value={email}
              onChange={(e) => {
                setEmail(e.target.value);
                // reset OTP view if email changes
                setOtp("");
                setOtpSent(false);
              }}
              required
            />
          </div>

          {/* Auditor password flow (UI only change; logic identical) */}
          {isAuditorEmail && (
            <form onSubmit={handleAuditorSubmit} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="password">Password</Label>
                <Input
                  id="password"
                  type="password"
                  placeholder="Enter your password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                />
              </div>
              <Button
                type="submit"
                className="w-full"
                disabled={isLoading}
              >
                {isLoading ? "Signing in..." : "Sign In"}
              </Button>
            </form>
          )}

          {/* OTP flow for everyone else (UI only change; logic identical) */}
          {!isAuditorEmail && (
            <form
              className="space-y-4"
              onSubmit={otpSent ? handleVerifyOtp : handleSendOtp}
            >
              {!otpSent ? (
                <Button
                  type="submit"
                  className="w-full"
                  disabled={isLoading || !email.trim()}
                >
                  {isLoading ? "Sending OTP..." : "Send OTP"}
                </Button>
              ) : (
                <>
                  <div className="space-y-2">
                    <Label htmlFor="otp">Enter OTP</Label>
                    <Input
                      id="otp"
                      type="text"
                      inputMode="numeric"
                      pattern="[0-9]*"
                      placeholder="4-digit OTP"
                      value={otp}
                      onChange={(e) => setOtp(e.target.value)}
                      required
                    />
                  </div>
                  <div className="flex gap-2">
                    <Button
                      type="button"
                      variant="outline"
                      className="w-1/2"
                      onClick={handleSendOtp}
                      disabled={isLoading}
                    >
                      Resend OTP
                    </Button>
                    <Button
                      type="submit"
                      className="w-1/2"
                      disabled={isLoading}
                    >
                      {isLoading ? "Verifying..." : "Verify & Sign In"}
                    </Button>
                  </div>
                </>
              )}
            </form>
          )}
        </div>
      </div>

      {/* Footer */}
      <footer className="w-full p-4 bg-gray-100 border-t text-center text-sm text-gray-600">
        © {new Date().getFullYear()} Premier Energies. All rights reserved.
      </footer>
    </div>
  );
};
