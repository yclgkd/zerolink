package protocol

type RouteSpec struct {
	Name    string
	Method  string
	Pattern string
}

var routeSpecs = []RouteSpec{
	{Name: "create_begin", Method: "POST", Pattern: "/api/create_begin/{uuid}"},
	{Name: "create_finish", Method: "POST", Pattern: "/api/create_finish/{uuid}"},
	{Name: "lock_begin", Method: "POST", Pattern: "/api/lock_begin/{uuid}"},
	{Name: "lock_commit", Method: "POST", Pattern: "/api/lock_commit/{uuid}"},
	{Name: "compound_begin", Method: "POST", Pattern: "/api/manage/compound_begin/{uuid}"},
	{Name: "compound_commit", Method: "POST", Pattern: "/api/manage/compound_commit/{uuid}"},
	{Name: "delete_commit", Method: "POST", Pattern: "/api/delete_commit/{uuid}"},
	{Name: "public_status", Method: "GET", Pattern: "/api/public/{uuid}"},
	{Name: "decrypt_fetch", Method: "GET", Pattern: "/api/decrypt_fetch/{uuid}"},
	{Name: "ws", Method: "GET", Pattern: "/api/ws/{uuid}"},
}

func RouteSpecs() []RouteSpec {
	specs := make([]RouteSpec, len(routeSpecs))
	copy(specs, routeSpecs)
	return specs
}
