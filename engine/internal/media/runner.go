package media

import (
	"bytes"
	"context"
	"fmt"
	"os/exec"
	"strings"
)

type Runner interface {
	Run(ctx context.Context, name string, args ...string) ([]byte, []byte, error)
}

type ExecRunner struct{}

// Run executes a child process and captures stdout and stderr separately.
func (ExecRunner) Run(ctx context.Context, name string, args ...string) ([]byte, []byte, error) {
	command := exec.CommandContext(ctx, name, args...)
	var stdout bytes.Buffer
	var stderr bytes.Buffer
	command.Stdout = &stdout
	command.Stderr = &stderr

	if err := command.Run(); err != nil {
		message := strings.TrimSpace(stderr.String())
		if len(message) > 4096 {
			message = message[len(message)-4096:]
		}
		return stdout.Bytes(), stderr.Bytes(), fmt.Errorf("%s failed: %w: %s", name, err, message)
	}

	return stdout.Bytes(), stderr.Bytes(), nil
}

// ResolveExecutable returns an explicit executable path or searches PATH.
func ResolveExecutable(explicitPath, fallbackName string) (string, error) {
	if explicitPath != "" {
		if _, err := exec.LookPath(explicitPath); err != nil {
			return "", fmt.Errorf("%s is not executable: %w", explicitPath, err)
		}
		return explicitPath, nil
	}

	resolved, err := exec.LookPath(fallbackName)
	if err != nil {
		return "", fmt.Errorf("%s was not found in PATH", fallbackName)
	}
	return resolved, nil
}

// FirstLine returns the first non-empty line from command output.
func FirstLine(value []byte) string {
	for _, line := range strings.Split(string(value), "\n") {
		trimmed := strings.TrimSpace(line)
		if trimmed != "" {
			return trimmed
		}
	}
	return ""
}
