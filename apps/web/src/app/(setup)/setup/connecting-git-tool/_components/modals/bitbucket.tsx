"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@components/ui/button";
import { Card, CardHeader } from "@components/ui/card";
import {
    Collapsible,
    CollapsibleContent,
    CollapsibleTrigger,
} from "@components/ui/collapsible";
import { FormControl } from "@components/ui/form-control";
import { Input } from "@components/ui/input";
import { KodyReviewPreview } from "@components/ui/kody-review-preview";
import { magicModal } from "@components/ui/magic-modal";
import { Switch } from "@components/ui/switch";
import { zodResolver } from "@hookform/resolvers/zod";
import { createCodeManagementIntegration } from "@services/codeManagement/fetch";
import { AxiosError } from "axios";
import { SaveIcon } from "lucide-react";
import { Controller, useForm } from "react-hook-form";
import { GitTokenDocs } from "src/core/components/system/git-token-docs";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from "src/core/components/ui/dialog";
import { AuthMode, PlatformType } from "src/core/types";
import { z } from "zod";

const tokenFormSchema = z.object({
    token: z.string().min(1, {
        error: "Enter a Token",
    }),
    username: z.string().min(1, {
        error: "Enter a Username",
    }),
    email: z.email({
        error: "Enter a valid email",
    }),
    selfHostedUrl: z.string().optional(),
});

function getUsernameFromEmail(email: string): string {
    return email.split("@")[0] || email;
}

export const BitbucketTokenModal = (props: {
    teamId: string;
    userId: string;
    userEmail: string;
}) => {
    const router = useRouter();
    const [selfhosted, setSelfhosted] = useState(false);
    const nextStepPath = "/setup/choosing-repositories";

    const form = useForm({
        resolver: zodResolver(tokenFormSchema),
        mode: "all",
        defaultValues: {
            token: "",
            username: "",
            email: "",
            selfHostedUrl: "",
        },
    });

    const submit = async (data: z.infer<typeof tokenFormSchema>) => {
        magicModal.lock();

        try {
            const integrationResponse = await createCodeManagementIntegration({
                integrationType: PlatformType.BITBUCKET,
                authMode: AuthMode.TOKEN,
                token: data.token,
                organizationAndTeamData: {
                    teamId: props.teamId,
                },
                username: data.username,
                email: data.email,
                host: selfhosted ? data.selfHostedUrl : undefined,
            });

            switch (integrationResponse.data.status) {
                case "SUCCESS": {
                    router.push(nextStepPath);
                    break;
                }

                case "NO_ORGANIZATION": {
                    router.replace("/setup/organization-account-required");
                    break;
                }
                case "NO_REPOSITORIES": {
                    router.replace("/setup/no-repositories");
                    break;
                }
            }

            magicModal.hide();
        } catch (error) {
            magicModal.unlock();

            if (error instanceof AxiosError && error.status === 400) {
                form.setError("token", {
                    type: "custom",
                    message: "Invalid Token or Username",
                });
            }
        }
    };

    const {
        isDirty: formIsDirty,
        isValid: formIsValid,
        isSubmitting: formIsSubmitting,
    } = form.formState;

    const watchedUsername = form.watch("username");
    const displayName =
        watchedUsername || getUsernameFromEmail(props.userEmail);

    return (
        <Dialog open onOpenChange={() => magicModal.hide()}>
            <DialogContent>
                <form onSubmit={form.handleSubmit(submit)}>
                    <DialogHeader>
                        <DialogTitle>Bitbucket API Token</DialogTitle>
                        <DialogDescription></DialogDescription>
                    </DialogHeader>

                    <div className="border-informative/20 bg-informative/5 my-4 flex flex-col gap-3 rounded-xl border p-4">
                        <p className="text-text-secondary text-sm">
                            Reviews will be posted from the token owner's
                            account:
                        </p>
                        <KodyReviewPreview
                            mode="inline"
                            author={{
                                name: displayName,
                            }}
                            comment="Consider adding error handling here to prevent unhandled promise rejections."
                            codeLine={{
                                number: 42,
                                content: "const result = await fetchData();",
                            }}
                        />
                    </div>

                    <div className="flex flex-col gap-4">
                        <Controller
                            name="username"
                            control={form.control}
                            render={({ field, fieldState }) => (
                                <FormControl.Root>
                                    <FormControl.Input>
                                        <Input
                                            {...field}
                                            type="text"
                                            error={fieldState.error}
                                            placeholder="Paste your Bitbucket username here"
                                        />
                                    </FormControl.Input>

                                    <FormControl.Error>
                                        {fieldState.error?.message}
                                    </FormControl.Error>
                                </FormControl.Root>
                            )}
                        />

                        <Controller
                            name="email"
                            control={form.control}
                            render={({ field, fieldState }) => (
                                <FormControl.Root>
                                    <FormControl.Input>
                                        <Input
                                            {...field}
                                            type="email"
                                            error={fieldState.error}
                                            placeholder="Enter your email address"
                                        />
                                    </FormControl.Input>

                                    <FormControl.Error>
                                        {fieldState.error?.message}
                                    </FormControl.Error>
                                </FormControl.Root>
                            )}
                        />

                        <Controller
                            name="token"
                            control={form.control}
                            render={({ field, fieldState }) => (
                                <FormControl.Root>
                                    <FormControl.Input>
                                        <Input
                                            {...field}
                                            type="password"
                                            error={fieldState.error}
                                            placeholder="Paste your API token here"
                                        />
                                    </FormControl.Input>

                                    <FormControl.Error>
                                        {fieldState.error?.message}
                                    </FormControl.Error>
                                </FormControl.Root>
                            )}
                        />

                        <Collapsible
                            open={selfhosted}
                            onOpenChange={(open) => setSelfhosted(open)}
                            className="flex flex-col gap-1">
                            <div className="relative">
                                <CollapsibleTrigger asChild>
                                    <Button
                                        type="button"
                                        variant="helper"
                                        size="lg"
                                        className="w-full items-center justify-between py-4">
                                        <FormControl.Label className="mb-0">
                                            Self-hosted
                                        </FormControl.Label>
                                    </Button>
                                </CollapsibleTrigger>

                                <div className="pointer-events-none absolute inset-y-0 right-6 flex items-center">
                                    <Switch decorative checked={selfhosted} />
                                </div>
                            </div>

                            <CollapsibleContent>
                                <Card color="lv1">
                                    <CardHeader>
                                        <Controller
                                            name="selfHostedUrl"
                                            control={form.control}
                                            rules={{
                                                validate: (value) =>
                                                    !selfhosted ||
                                                    !!value?.trim() ||
                                                    "Enter the Bitbucket base URL",
                                            }}
                                            render={({ field, fieldState }) => (
                                                <FormControl.Root>
                                                    <FormControl.Label
                                                        htmlFor={field.name}>
                                                        Bitbucket Base URL
                                                    </FormControl.Label>

                                                    <FormControl.Input>
                                                        <Input
                                                            {...field}
                                                            id={field.name}
                                                            error={
                                                                fieldState.error
                                                            }
                                                            placeholder="https://bitbucket.your-company.com"
                                                        />
                                                    </FormControl.Input>

                                                    <FormControl.Error>
                                                        {
                                                            fieldState.error
                                                                ?.message
                                                        }
                                                    </FormControl.Error>
                                                </FormControl.Root>
                                            )}
                                        />
                                    </CardHeader>
                                </Card>
                            </CollapsibleContent>
                        </Collapsible>

                        <GitTokenDocs provider="bitbucket" />
                    </div>

                    <DialogFooter>
                        <Button
                            size="md"
                            type="button"
                            variant="cancel"
                            onClick={() => magicModal.hide()}>
                            Cancel
                        </Button>

                        <Button
                            size="md"
                            type="submit"
                            variant="primary"
                            leftIcon={<SaveIcon />}
                            loading={formIsSubmitting}
                            disabled={
                                !formIsValid ||
                                (selfhosted &&
                                    !form.watch("selfHostedUrl")?.trim())
                            }>
                            Validate and save
                        </Button>
                    </DialogFooter>
                </form>
            </DialogContent>
        </Dialog>
    );
};
