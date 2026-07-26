import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { getAccessToken } from '@/lib/dashboardData';
import { ChatPanel } from './ChatPanel';

export default async function ChatPage() {
  const accessToken = await getAccessToken();

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-semibold">Chat</h1>
        <p className="text-sm text-muted-foreground">
          Ask Switch about your accounts, spending, or standing preferences — it can call your connected tools live.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Conversation</CardTitle>
        </CardHeader>
        <CardContent>
          <ChatPanel accessToken={accessToken} />
        </CardContent>
      </Card>
    </div>
  );
}
