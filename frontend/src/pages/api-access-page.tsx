import { type ReactNode, useMemo, useState } from "react";
import { Field, FormPage, FormPanel, FormSection } from "@/components/form-layout";
import { PageActionBar, PageActionBarActions, PageActionButton } from "@/components/page-action-bar";
import { PageIntro } from "@/components/page-intro";
import { PageLoadBoundary, PageLoadingState } from "@/components/page-load-state";
import { PageLabel } from "@/components/page-label";
import { Stack } from "@/components/stack";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { usePageResource } from "@/hooks/use-page-resource";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { toast } from "@/lib/toast";

type ApiAccessPageData = {
  status: {
    configured: boolean;
    createdAt: string | null;
  };
  docs: Awaited<ReturnType<typeof api.getCompanyApiDocs>>["docs"] | null;
};

export function ApiAccessPage() {
  const { companySession } = useAuth();
  const [revealedKey, setRevealedKey] = useState<string | null>(null);
  const [rotating, setRotating] = useState(false);
  const pageResource = usePageResource<ApiAccessPageData>({
    enabled: Boolean(companySession),
    deps: [companySession?.token],
    load: async () => {
      if (!companySession) {
        return {
          status: { configured: false, createdAt: null },
          docs: null,
        };
      }

      return loadApiAccessData(companySession.token);
    },
  });

  const docs = pageResource.data?.docs;
  const status = pageResource.data?.status ?? { configured: false, createdAt: null };
  const baseUrl = useMemo(() => window.location.origin, []);

  async function handleRotate() {
    if (!companySession) {
      return;
    }

    try {
      setRotating(true);
      const response = await api.rotateCompanyApiKey(companySession.token);
      setRevealedKey(response.apiKey);
      pageResource.setData((current) => ({
        status: response.status,
        docs: current?.docs ?? null,
      }));
      toast({ title: "API key rotated" });
    } catch (error) {
      toast({
        title: "Could not rotate API key",
        description: error instanceof Error ? error.message : "Request failed",
      });
    } finally {
      setRotating(false);
    }
  }

  function handleDownloadMarkdown() {
    if (!docs) {
      return;
    }

    const blob = new Blob([docs.markdown], { type: "text/markdown;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");

    anchor.href = url;
    anchor.download = "company-api.md";
    anchor.rel = "noopener";
    document.body.appendChild(anchor);
    anchor.click();
    document.body.removeChild(anchor);
    window.setTimeout(() => URL.revokeObjectURL(url), 0);
  }

  return (
    <FormPage>
      <PageLoadBoundary
        intro={
          <PageIntro>
            <PageLabel
              title="API"
              description="A single company key, live schema discovery, generic read and write endpoints, and documentation that regenerates itself from the database."
            />
            <PageActionBar>
              <PageActionBarActions>
                <PageActionButton type="button" onClick={handleDownloadMarkdown} disabled={!docs}>
                  Download markdown
                </PageActionButton>
                <PageActionButton type="button" onClick={() => void handleRotate()} disabled={rotating}>
                  {rotating ? "Rotating..." : status.configured ? "Rotate key" : "Create key"}
                </PageActionButton>
              </PageActionBarActions>
            </PageActionBar>
          </PageIntro>
        }
        loading={pageResource.isLoading}
        refreshing={pageResource.isRefreshing}
        skeleton={<PageLoadingState />}
      >
        <Stack gap="lg">
          <FormPanel>
            <FormSection>
              <Stack gap="md">
                <Stack gap="md" className="min-w-0 rounded-2xl border border-border p-5">
                  <Field label="Current key">
                    <Input readOnly value={revealedKey ?? "Rotate the key to reveal the new value once."} />
                  </Field>
                  <p className="text-xs leading-5 text-muted-foreground">
                    The full key is only shown once after rotation. Store it in your password manager, deployment secret store, or
                    integration vault.
                  </p>
                </Stack>

                <Stack gap="md" className="min-w-0 rounded-2xl border border-border p-5">
                  <Stack gap="sm">
                    <Badge variant={status.configured ? "default" : "outline"}>
                      {status.configured ? "Key active" : "Key missing"}
                    </Badge>
                    {docs ? <Badge variant="outline">{docs.tables.length} tables discovered</Badge> : null}
                    {docs ? <Badge variant="outline">{docs.mutation.actions.length} write actions</Badge> : null}
                  </Stack>
                  <Stack gap="xs">
                    <p className="text-base font-semibold text-foreground">Enterprise key model</p>
                    <p className="text-sm text-muted-foreground">
                      One active company key, cryptographically generated, hash-only storage, instant rotation, automatic company
                      scoping, and runtime schema validation for every request.
                    </p>
                  </Stack>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <Metric label="Auth header" value={docs?.auth.header ?? "X-API-Key"} />
                    <Metric label="Base path" value={docs ? `${baseUrl}${docs.auth.basePath}` : `${baseUrl}/api/external`} />
                    <Metric label="Created at" value={status.createdAt ?? "Not available"} />
                    <Metric label="Storage" value={docs?.auth.storage ?? "Hash-only key storage"} />
                  </div>
                </Stack>
              </Stack>
            </FormSection>
          </FormPanel>

          {docs ? (
            <FormPanel>
              <Tabs defaultValue="overview" className="w-full">
                <TabsList className="h-auto w-full flex-wrap justify-start gap-1 rounded-2xl bg-muted/60 p-1">
                  <TabsTrigger value="overview" className="rounded-xl">
                    Overview
                  </TabsTrigger>
                  <TabsTrigger value="read" className="rounded-xl">
                    Read
                  </TabsTrigger>
                  <TabsTrigger value="write" className="rounded-xl">
                    Write
                  </TabsTrigger>
                  <TabsTrigger value="schema" className="rounded-xl">
                    Schema
                  </TabsTrigger>
                </TabsList>

                <TabsContent value="overview" className="mt-5">
                  <Stack gap="lg">
                    <div className="grid gap-4 xl:grid-cols-2">
                      <DocPanel
                        title="Endpoints"
                        description="Stable addresses. Schema intelligence lives in metadata and request bodies, not in URL sprawl."
                      >
                        <Stack gap="sm">
                          {docs.endpoints.map((endpoint) => (
                            <div key={`${endpoint.method}-${endpoint.path}`} className="rounded-2xl border border-border p-4">
                              <div className="flex flex-wrap items-center gap-2">
                                <Badge variant="outline">{endpoint.method}</Badge>
                                <code className="text-sm text-foreground">{`${baseUrl}${endpoint.path}`}</code>
                              </div>
                              <p className="mt-3 text-sm font-medium text-foreground">{endpoint.title}</p>
                              <p className="mt-1 text-sm text-muted-foreground">{endpoint.description}</p>
                            </div>
                          ))}
                        </Stack>
                      </DocPanel>

                      <DocPanel
                        title="Reliability rules"
                        description="The backend guards every request before SQL is assembled."
                      >
                        <Stack gap="sm">
                          {docs.query.notes.concat(docs.mutation.notes).map((note) => (
                            <p key={note} className="text-sm leading-6 text-muted-foreground">
                              {note}
                            </p>
                          ))}
                        </Stack>
                      </DocPanel>
                    </div>
                  </Stack>
                </TabsContent>

                <TabsContent value="read" className="mt-5">
                  <div className="grid gap-4 xl:grid-cols-2">
                    <DocPanel
                      title="Read contract"
                      description="Use the schema endpoint to discover tables and columns, then POST query bodies to the generic query endpoint."
                    >
                      <div className="flex flex-wrap gap-2">
                        {docs.query.operators.map((operator) => (
                          <Badge key={operator} variant="outline">
                            {operator}
                          </Badge>
                        ))}
                      </div>
                      {docs.query.example ? <CodeBlock title="Example query body" code={JSON.stringify(docs.query.example, null, 2)} /> : null}
                    </DocPanel>

                    <DocPanel
                      title="Read examples"
                      description="Generated from the current schema so they stay aligned with the database as it evolves."
                    >
                      {docs.query.curlExample ? <CodeBlock title="cURL" code={docs.query.curlExample} /> : null}
                      {docs.query.powerQueryExample ? <CodeBlock title="Excel / Power Query" code={docs.query.powerQueryExample} /> : null}
                    </DocPanel>
                  </div>
                </TabsContent>

                <TabsContent value="write" className="mt-5">
                  <div className="grid gap-4 2xl:grid-cols-3">
                    <MutationCard
                      title="Insert"
                      description="Create company-scoped rows. company_id is injected automatically."
                      body={docs.mutation.examples.insert}
                      curl={docs.mutation.curlExamples.insert}
                    />
                    <MutationCard
                      title="Update"
                      description="Update rows with required filters so writes stay targeted."
                      body={docs.mutation.examples.update}
                      curl={docs.mutation.curlExamples.update}
                    />
                    <MutationCard
                      title="Delete"
                      description="Delete rows with required filters and automatic company scoping."
                      body={docs.mutation.examples.delete}
                      curl={docs.mutation.curlExamples.delete}
                    />
                  </div>
                </TabsContent>

                <TabsContent value="schema" className="mt-5">
                  <Stack gap="md">
                    {docs.tables.map((table) => (
                      <div key={table.name} className="rounded-2xl border border-border">
                        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-5 py-4">
                          <div className="flex min-w-0 flex-wrap items-center gap-2">
                            <p className="text-sm font-semibold text-foreground">{table.name}</p>
                            <Badge variant="outline">{table.columns.length} columns</Badge>
                          </div>
                          {table.defaultOrderBy.length > 0 ? (
                            <span className="text-xs text-muted-foreground">
                              default sort: {table.defaultOrderBy.map((item) => `${item.column} ${item.direction}`).join(", ")}
                            </span>
                          ) : null}
                        </div>
                        <div className="overflow-x-auto px-5 py-4">
                          <table className="min-w-full text-sm">
                            <thead>
                              <tr className="border-b border-border text-left text-muted-foreground">
                                <th className="pb-3 pr-4 font-medium">Column</th>
                                <th className="pb-3 pr-4 font-medium">Type</th>
                                <th className="pb-3 pr-4 font-medium">Nullable</th>
                                <th className="pb-3 pr-4 font-medium">Primary</th>
                                <th className="pb-3 font-medium">Example</th>
                              </tr>
                            </thead>
                            <tbody>
                              {table.columns.map((column) => (
                                <tr key={`${table.name}-${column.name}`} className="border-b border-border/60 align-top last:border-b-0">
                                  <td className="py-3 pr-4 font-medium text-foreground">{column.name}</td>
                                  <td className="py-3 pr-4 text-muted-foreground">{column.type}</td>
                                  <td className="py-3 pr-4 text-muted-foreground">{column.nullable ? "Yes" : "No"}</td>
                                  <td className="py-3 pr-4 text-muted-foreground">{column.primaryKey ? "Yes" : "No"}</td>
                                  <td className="py-3 font-mono text-xs text-muted-foreground">
                                    {column.example === null ? "null" : String(column.example)}
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      </div>
                    ))}
                  </Stack>
                </TabsContent>
              </Tabs>
            </FormPanel>
          ) : null}
        </Stack>
      </PageLoadBoundary>
    </FormPage>
  );
}

async function loadApiAccessData(token: string): Promise<ApiAccessPageData> {
  const [statusResponse, docsResponse] = await Promise.all([
    api.getCompanyApiKeyStatus(token),
    api.getCompanyApiDocs(token),
  ]);

  return {
    status: statusResponse.status,
    docs: docsResponse.docs,
  };
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-1 rounded-xl bg-muted/35 px-3 py-3">
      <span className="text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground">{label}</span>
      <span className="break-words text-sm leading-6 text-foreground">{value}</span>
    </div>
  );
}

function DocPanel({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children: ReactNode;
}) {
  return (
    <Stack gap="md" className="min-w-0 rounded-2xl border border-border p-5">
      <Stack gap="xs">
        <p className="text-sm font-semibold text-foreground">{title}</p>
        <p className="text-sm text-muted-foreground">{description}</p>
      </Stack>
      {children}
    </Stack>
  );
}

function MutationCard({
  title,
  description,
  body,
  curl,
}: {
  title: string;
  description: string;
  body: unknown;
  curl: string | null;
}) {
  return (
    <DocPanel title={title} description={description}>
      {body ? <CodeBlock title="Body" code={JSON.stringify(body, null, 2)} /> : <p className="text-sm text-muted-foreground">No example available yet.</p>}
      {curl ? <CodeBlock title="cURL" code={curl} /> : null}
    </DocPanel>
  );
}

function CodeBlock({ title, code }: { title: string; code: string }) {
  return (
    <Stack gap="xs" className="min-w-0">
      <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">{title}</p>
      <pre className="max-w-full overflow-x-auto whitespace-pre-wrap break-words rounded-2xl bg-muted/35 p-4 text-xs leading-6 text-foreground">
        <code>{code}</code>
      </pre>
    </Stack>
  );
}
