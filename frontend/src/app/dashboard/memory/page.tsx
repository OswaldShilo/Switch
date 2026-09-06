import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { apiGet } from '@/lib/apiClient';
import { getAccessToken } from '@/lib/dashboardData';
import { DeleteMemoryButton } from './DeleteMemoryButton';

interface MemoryDto {
  memoryId: string;
  type: 'explicit' | 'implicit';
  content: string;
  tags: string[];
  createdAt: string;
}

export default async function MemoryPage() {
  const accessToken = await getAccessToken();
  const memories = await apiGet<MemoryDto[]>('/api/memories', accessToken);

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-semibold">Memory</h1>
        <p className="text-sm text-muted-foreground">
          What Switch knows about you — facts, preferences, and rules it will respect in chat.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Remembered facts</CardTitle>
        </CardHeader>
        <CardContent>
          {memories.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Nothing remembered yet — tell Switch a rule or preference in Chat.
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Content</TableHead>
                  <TableHead>Tags</TableHead>
                  <TableHead>Remembered</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {memories.map((memory) => (
                  <TableRow key={memory.memoryId}>
                    <TableCell>{memory.content}</TableCell>
                    <TableCell>{memory.tags.join(', ')}</TableCell>
                    <TableCell>{new Date(memory.createdAt).toLocaleDateString('en-IN')}</TableCell>
                    <TableCell>
                      <DeleteMemoryButton memoryId={memory.memoryId} accessToken={accessToken} />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
