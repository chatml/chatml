package main

import (
	"encoding/json"

	"github.com/chatml/chatml-core/agent"
	"github.com/charmbracelet/huh"
)

type approvalResult struct {
	action    string
	specifier string
	input     json.RawMessage
}

type questionResult struct {
	answers map[string]string
}

type planResult struct {
	approved bool
	reason   string
}

func promptToolApproval(toolName, specifier string, _ *styles) approvalResult {
	title := toolName
	if specifier != "" {
		title += "(" + specifier + ")"
	}
	title += " requires approval"

	var action string
	err := huh.NewSelect[string]().
		Title(title).
		Options(
			huh.NewOption("Yes, allow this", "allow_once"),
			huh.NewOption("Yes, always allow", "allow_session"),
			huh.NewOption("No, deny this", "deny_once"),
		).
		Value(&action).
		Run()

	if err != nil {
		return approvalResult{action: "deny_once"}
	}
	return approvalResult{action: action}
}

func promptUserQuestion(questions []agent.UserQuestion, _ *styles) questionResult {
	answers := make(map[string]string)

	for _, q := range questions {
		if len(q.Options) > 0 {
			// Multi-choice
			var selected string
			opts := make([]huh.Option[string], 0, len(q.Options))
			for _, opt := range q.Options {
				label := opt.Label
				if opt.Description != "" {
					label += " -- " + opt.Description
				}
				opts = append(opts, huh.NewOption(label, opt.Label))
			}
			_ = huh.NewSelect[string]().
				Title(q.Question).
				Options(opts...).
				Value(&selected).
				Run()
			answers[q.Question] = selected
		} else {
			// Free text
			var answer string
			_ = huh.NewInput().
				Title(q.Question).
				Value(&answer).
				Run()
			answers[q.Question] = answer
		}
	}

	return questionResult{answers: answers}
}

func promptPlanReview(_ *styles) planResult {
	var action string
	_ = huh.NewSelect[string]().
		Title("Review the plan").
		Options(
			huh.NewOption("Approve and proceed", "approve"),
			huh.NewOption("Reject with feedback", "reject"),
		).
		Value(&action).
		Run()

	if action == "reject" {
		var reason string
		_ = huh.NewInput().
			Title("Feedback (optional)").
			Value(&reason).
			Run()
		return planResult{approved: false, reason: reason}
	}
	return planResult{approved: true}
}
