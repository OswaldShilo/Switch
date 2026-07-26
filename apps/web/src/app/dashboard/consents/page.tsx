import type { ConsentDto } from '@switch/shared';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { apiGet } from '@/lib/apiClient';
import { getAccessToken } from '@/lib/dashboardData';
import { RevokeButton } from './RevokeButton';

function badgeVariantForStatus(status: string): 'default' | 'destructive' | 'secondary' | 'outline' {
  switch (status) {
    case 'ACTIVE':
      return 'default';
    case 'REVOKED':
    case 'REJECTED':
      return 'destructive';
    case 'PENDING':
      return 'secondary';
    default:
      return 'outline';
  }
}

export default async function ConsentsPage() {
  const accessToken = await getAccessToken();
  const consents = await apiGet<ConsentDto[]>('/api/consents', accessToken);

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-semibold">Consent manager</h1>
        <p className="text-sm text-muted-foreground">Manage which bank connections can share data with Switch.</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Consents</CardTitle>
        </CardHeader>
        <CardContent>
          {consents.length === 0 ? (
            <p className="text-sm text-muted-foreground">No consents yet.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Bank (fip_id)</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Purpose</TableHead>
                  <TableHead>Expiry</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {consents.map((consent) => (
                  <TableRow key={consent.consentId}>
                    <TableCell>{consent.fipId}</TableCell>
                    <TableCell>
                      <Badge variant={badgeVariantForStatus(consent.status)}>{consent.status}</Badge>
                    </TableCell>
                    <TableCell>{consent.purpose}</TableCell>
                    <TableCell>{new Date(consent.expiryAt).toLocaleDateString('en-IN')}</TableCell>
                    <TableCell>
                      <RevokeButton
                        consentId={consent.consentId}
                        accessToken={accessToken}
                        disabled={consent.status !== 'ACTIVE'}
                      />
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
