import React, { useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { useAuth } from '@/hooks/useAuth';
import { toast } from '@/hooks/use-toast';
import { Shield, Mail, Lock, KeyRound } from 'lucide-react';

export const Login: React.FC = () => {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState(''); // used only for auditor
  const [otp, setOtp] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [otpSent, setOtpSent] = useState(false);

  const { login, sendOtp, verifyOtp } = useAuth();

  // Only this email retains password login (auditor hardcoded)
  const isAuditorEmail = email.trim().toLowerCase() === 'santosh.kumar@protivitiglobal.com';

  const handleAuditorSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    setTimeout(() => {
      const success = login(email, password);
      if (success) {
        toast({
          title: 'Login Successful',
          description: 'Welcome to Audit @Premier Energies',
        });
      } else {
        toast({
          title: 'Login Failed',
          description: 'Invalid email or password',
          variant: 'destructive',
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
          title: 'OTP sent',
          description: 'Please check your mailbox for the 4-digit OTP (valid 5 minutes).',
        });
      } else {
        toast({
          title: 'Unable to send OTP',
          description: 'Your email may not be registered or server is unavailable.',
          variant: 'destructive',
        });
      }
    } finally {
      setIsLoading(false);
    }
  };

  const handleVerifyOtp = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!otp.trim()) {
      toast({ title: 'Enter OTP', description: 'Please enter the 4-digit OTP.', variant: 'destructive' });
      return;
    }
    setIsLoading(true);
    try {
      const ok = await verifyOtp(email, otp);
      if (ok) {
        toast({
          title: 'Login Successful',
          description: 'Welcome to Audit @Premier Energies',
        });
      } else {
        toast({
          title: 'Invalid or expired OTP',
          description: 'Please request a new OTP and try again.',
          variant: 'destructive',
        });
      }
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-blue-50 via-white to-green-50 p-4">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <div className="flex justify-center mb-4">
            <div className="p-3 bg-gradient-to-r from-blue-500 to-green-500 rounded-full">
              <Shield className="h-8 w-8 text-white" />
            </div>
          </div>
          <h1 className="text-3xl font-bold text-gray-900 mb-2">Audit @Premier Energies</h1>
          <p className="text-gray-600">Comprehensive Audit Management System</p>
        </div>

        <Card className="shadow-xl border-0 bg-white/80 backdrop-blur-sm">
          <CardHeader className="space-y-1">
            <CardTitle className="text-2xl text-center">Sign In</CardTitle>
            <CardDescription className="text-center">
              {isAuditorEmail ? 'Auditor sign-in (password)' : 'Employee sign-in (email OTP)'}
            </CardDescription>
          </CardHeader>
          <CardContent>
            {/* Shared email field */}
            <div className="space-y-2 mb-4">
              <Label htmlFor="email">Email</Label>
              <div className="relative">
                <Mail className="absolute left-3 top-3 h-4 w-4 text-gray-400" />
                <Input
                  id="email"
                  type="email"
                  placeholder="Enter your email"
                  value={email}
                  onChange={(e) => {
                    setEmail(e.target.value);
                    // reset OTP view if email changes
                    setOtp('');
                    setOtpSent(false);
                  }}
                  className="pl-10"
                  required
                />
              </div>
            </div>

            {/* Auditor password flow (unchanged) */}
            {isAuditorEmail && (
              <form onSubmit={handleAuditorSubmit} className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="password">Password</Label>
                  <div className="relative">
                    <Lock className="absolute left-3 top-3 h-4 w-4 text-gray-400" />
                    <Input
                      id="password"
                      type="password"
                      placeholder="Enter your password"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      className="pl-10"
                      required
                    />
                  </div>
                </div>
                <Button
                  type="submit"
                  className="w-full bg-gradient-to-r from-blue-500 to-green-500 hover:from-blue-600 hover:to-green-600 text-white"
                  disabled={isLoading}
                >
                  {isLoading ? 'Signing in...' : 'Sign In'}
                </Button>
              </form>
            )}

            {/* OTP flow for everyone else */}
            {!isAuditorEmail && (
              <form className="space-y-4" onSubmit={otpSent ? handleVerifyOtp : handleSendOtp}>
                {!otpSent ? (
                  <Button
                    type="submit"
                    className="w-full bg-gradient-to-r from-blue-500 to-green-500 hover:from-blue-600 hover:to-green-600 text-white"
                    disabled={isLoading || !email.trim()}
                  >
                    {isLoading ? 'Sending OTP...' : 'Send OTP'}
                  </Button>
                ) : (
                  <>
                    <div className="space-y-2">
                      <Label htmlFor="otp">Enter OTP</Label>
                      <div className="relative">
                        <KeyRound className="absolute left-3 top-3 h-4 w-4 text-gray-400" />
                        <Input
                          id="otp"
                          type="text"
                          inputMode="numeric"
                          pattern="[0-9]*"
                          placeholder="4-digit OTP"
                          value={otp}
                          onChange={(e) => setOtp(e.target.value)}
                          className="pl-10"
                          required
                        />
                      </div>
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
                        className="w-1/2 bg-gradient-to-r from-blue-500 to-green-500 hover:from-blue-600 hover:to-green-600 text-white"
                        disabled={isLoading}
                      >
                        {isLoading ? 'Verifying...' : 'Verify & Sign In'}
                      </Button>
                    </div>
                  </>
                )}
              </form>
            )}

            <div className="mt-6 p-4 bg-gray-50 rounded-lg">
              <h3 className="font-semibold text-sm mb-2">Demo Access:</h3>
              <div className="text-xs space-y-1 text-gray-600">
                <p><strong>Auditor (password):</strong> santosh.kumar@protivitiglobal.com / santosh</p>
                <p><strong>Employees (OTP):</strong> Use your company email to receive OTP</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
};