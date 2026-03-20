"use client";

import { useMemo, useState } from "react";
import { Alert, AlertDescription, AlertTitle } from "@components/ui/alert";
import { Button } from "@components/ui/button";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from "@components/ui/dialog";
import { Switch } from "@components/ui/switch";
import { toast } from "@components/ui/toaster/use-toast";
import { useGetSelectedRepositories } from "@services/codeManagement/hooks";
import {
    createOrUpdateParameter,
    syncCentralizedConfig,
} from "@services/parameters/fetch";
import {
    ParametersConfigKey,
    type CentralizedConfigValue,
} from "@services/parameters/types";
import { AlertTriangleIcon, GitBranchIcon } from "lucide-react";

type CentralizedConfigModalProps = {
    teamId: string;
    open: boolean;
    onOpenChange: (open: boolean) => void;
    centralizedConfig: CentralizedConfigValue;
    onSaved: () => Promise<unknown>;
};

export const CentralizedConfigModal = ({
    teamId,
    open,
    onOpenChange,
    centralizedConfig,
    onSaved,
}: CentralizedConfigModalProps) => {
    const [enabled, setEnabled] = useState(centralizedConfig.enabled);
    const [loading, setLoading] = useState(false);
    const [errorMessage, setErrorMessage] = useState<string | null>(null);

    const { data: repositories = [], isLoading: isLoadingRepositories } =
        useGetSelectedRepositories(teamId);

    const kodusRepository = useMemo(
        () =>
            repositories.find(
                (repository) => repository.name.toLowerCase() === "kodus",
            ),
        [repositories],
    );

    const hasKodusRepository = Boolean(kodusRepository);

    const hasChanges =
        enabled !== centralizedConfig.enabled ||
        (enabled &&
            centralizedConfig.repository?.id !== (kodusRepository?.id ?? ""));

    const handleClose = (nextOpen: boolean) => {
        if (!nextOpen) {
            setEnabled(centralizedConfig.enabled);
            setErrorMessage(null);
        }

        onOpenChange(nextOpen);
    };

    const handleSave = async () => {
        if (enabled && !kodusRepository) {
            setErrorMessage(
                "A selected repository named 'kodus' is required to enable centralized config.",
            );
            return;
        }

        setLoading(true);
        setErrorMessage(null);

        try {
            const shouldRunInitialSync = enabled && !centralizedConfig.enabled;

            const result = await createOrUpdateParameter(
                ParametersConfigKey.CENTRALIZED_CONFIG,
                {
                    enabled,
                    repository: {
                        id: kodusRepository?.id ?? "",
                        name: "kodus",
                    },
                },
                teamId,
            );

            if (result?.error) {
                throw new Error("Failed to save centralized config.");
            }

            if (shouldRunInitialSync) {
                const syncResult = await syncCentralizedConfig(teamId);
                if (syncResult?.error) {
                    throw new Error("Failed to run initial centralized sync.");
                }
            }

            await onSaved();
            handleClose(false);

            toast({
                description: "Centralized config updated",
                variant: "success",
            });
        } catch (error) {
            setErrorMessage(
                "An error occurred while updating centralized config. Please try again.",
            );
        } finally {
            setLoading(false);
        }
    };

    return (
        <Dialog open={open} onOpenChange={handleClose}>
            <DialogContent className="max-w-lg">
                <DialogHeader>
                    <DialogTitle>Centralized Config</DialogTitle>
                    <DialogDescription>
                        Configure whether the <code>kodus</code> repository on
                        branch <code>main</code> is the authority for code
                        review settings.
                    </DialogDescription>
                </DialogHeader>

                <div className="space-y-4">
                    <div className="bg-card-lv2 border-card-lv3 flex items-center justify-between rounded-xl border p-4">
                        <div className="space-y-1">
                            <p className="text-sm font-medium">
                                Enable centralized config
                            </p>
                            <p className="text-text-secondary text-sm">
                                Use repository <code>kodus</code> as source of
                                truth.
                            </p>
                        </div>
                        <Switch
                            aria-label="Enable centralized config"
                            checked={enabled}
                            onCheckedChange={setEnabled}
                            disabled={loading || !hasKodusRepository}
                        />
                    </div>

                    <div className="bg-card-lv2 border-card-lv3 space-y-2 rounded-xl border p-4 text-sm">
                        <p className="font-medium">Repository requirement</p>
                        {isLoadingRepositories ? (
                            <p className="text-text-secondary">
                                Checking selected repositories...
                            </p>
                        ) : hasKodusRepository ? (
                            <p className="text-text-secondary flex items-center gap-2">
                                <GitBranchIcon className="size-4" />
                                Found <code>
                                    {kodusRepository?.name}
                                </code> (id:{" "}
                                <span className="tabular-nums">
                                    {kodusRepository?.id}
                                </span>
                                )
                            </p>
                        ) : (
                            <p className="text-danger">
                                No selected repository named <code>kodus</code>{" "}
                                was found. Add it in your git settings page.
                            </p>
                        )}
                    </div>

                    <Alert variant="warning">
                        <AlertTriangleIcon />
                        <AlertTitle>Important</AlertTitle>
                        <AlertDescription>
                            Enabling centralized config will replace existing
                            code review parameter settings with what exists in
                            the centralized repository.
                        </AlertDescription>
                    </Alert>
                </div>

                <DialogFooter>
                    {errorMessage && (
                        <p className="text-danger mr-auto text-sm">
                            {errorMessage}
                        </p>
                    )}
                    <Button
                        size="md"
                        variant="cancel"
                        onClick={() => handleClose(false)}
                        disabled={loading}>
                        Cancel
                    </Button>
                    <Button
                        size="md"
                        variant="primary"
                        onClick={handleSave}
                        loading={loading}
                        disabled={
                            loading ||
                            isLoadingRepositories ||
                            !hasChanges ||
                            (enabled && !hasKodusRepository)
                        }>
                        Save
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
};
